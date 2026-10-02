"""按 QQ 的练度存档：一个 QQ 一份 JSON，读改写全程加锁 + 原子替换。

为什么一人一文件
----------------
练度数据量很小（一个 QQ 几十个角色），但**写操作很频繁**（改一个数值就是一次
保存）。一人一文件既避开了全局锁，也让「删掉某个人的数据」退化成一次 rm。

数据结构（尽量贴近网页端存档，方便以后整档 JSON 互通）::

    {
      "version": 1,
      "synchroLevel": 200,
      "research": {"class": {...}, "corporation": {...}},
      "characters": {"5007": {角色记录}},
      "statsTable": {"nameCodes": ["5007", ...]},
      "updatedAt": "2026-10-02T13:00:00+00:00"
    }

角色记录的字段名与网页端表单完全一致（``limitBreak`` / ``affection`` /
``skills`` / ``cube`` / ``favoriteItem`` / ``equipments``），
``None`` 表示「暂无该项数据」—— 不是 0。

并发与安全
----------
同进程内按文件路径分配 ``threading.Lock``；写盘先落 ``.json.tmp`` 再
``os.replace`` 原子替换（同目录 rename 在同一文件系统上是原子的），
所以任何时刻读到的都是完整的上一版或完整的新版，不会是写了一半的 JSON。
"""
from __future__ import annotations

import copy
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import paths
from .log import logger
from .sharecode import PAYLOAD_TABLE, apply_defaults

STORE_VERSION = 1

# ── 取值范围（与网页端表单的 min/max 一一对应，改这里要同步改表单） ──────
SYNCHRO_MIN, SYNCHRO_MAX = 1, 2000
DEFAULT_SYNCHRO_LEVEL = 200

RESEARCH_CLASSES = ("Attacker", "Defender", "Supporter")
RESEARCH_CORPORATIONS = ("ELYSION", "MISSILIS", "TETRA", "PILGRIM", "ABNORMAL")
RESEARCH_MIN, RESEARCH_MAX = 0, 999
DEFAULT_RESEARCH_LEVEL = 1

GRADE_MIN, GRADE_MAX = 0, 3            # 突破（星）
CORE_MIN, CORE_MAX = 0, 7              # 核心
AFFECTION_MIN, AFFECTION_MAX = 0, 40
COMBAT_MIN, COMBAT_MAX = 0, 999999
SKILL_MIN, SKILL_MAX = 1, 10

SKILL_KEYS = ("skill1", "skill2", "burst")


class StoreError(ValueError):
    """存档操作不可完成。消息可以直接回给用户。"""


# ── 文件位置与锁 ─────────────────────────────────────────────────────

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()
_UNSAFE_NAME = re.compile(r"[^0-9A-Za-z_-]")


def user_store_path(uid) -> Path:
    """某 QQ 的存档文件路径。uid 里的怪异字符一律折成下划线。

    QQ 号本来就是纯数字，这里主要是防「其它平台拿 openid 当 uid」时
    把 ``/`` 之类的字符带进文件名。
    """
    stem = _UNSAFE_NAME.sub("_", str(uid or "").strip()) or "unknown"
    return paths.users_dir() / f"{stem[:120]}.json"


def _lock_for(path: Path) -> threading.Lock:
    key = str(path)
    with _LOCKS_GUARD:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = _LOCKS[key] = threading.Lock()
        return lock


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── 结构与归一化 ─────────────────────────────────────────────────────

def default_research() -> dict:
    return {
        "class": {key: DEFAULT_RESEARCH_LEVEL for key in RESEARCH_CLASSES},
        "corporation": {key: DEFAULT_RESEARCH_LEVEL for key in RESEARCH_CORPORATIONS},
    }


def default_store() -> dict:
    return {
        "version": STORE_VERSION,
        "synchroLevel": DEFAULT_SYNCHRO_LEVEL,
        "research": default_research(),
        "characters": {},
        "statsTable": {"nameCodes": []},
        "updatedAt": None,
    }


def normalize_research(raw) -> dict:
    """缺项补默认值、越界夹到范围内。

    老存档（研究等级功能之前建的）没有这两张表，读到就补全，
    免得出图时两个 LV 徽章空着。
    """
    table = default_research()
    if not isinstance(raw, dict):
        return table
    for group, keys in (("class", RESEARCH_CLASSES), ("corporation", RESEARCH_CORPORATIONS)):
        source = raw.get(group)
        if not isinstance(source, dict):
            continue
        for key in keys:
            value = source.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            table[group][key] = min(RESEARCH_MAX, max(RESEARCH_MIN, int(value)))
    return table


def _normalize(raw) -> dict:
    """把磁盘上的 JSON 规整成完整结构：缺的键补上，坏的值退回默认。"""
    store = default_store()
    if not isinstance(raw, dict):
        return store

    level = raw.get("synchroLevel")
    if isinstance(level, int) and not isinstance(level, bool) and SYNCHRO_MIN <= level <= SYNCHRO_MAX:
        store["synchroLevel"] = level

    store["research"] = normalize_research(raw.get("research"))

    characters = raw.get("characters")
    if isinstance(characters, dict):
        store["characters"] = {
            str(code): record for code, record in characters.items() if isinstance(record, dict)
        }

    table = (raw.get("statsTable") or {}).get("nameCodes") if isinstance(raw.get("statsTable"), dict) else None
    if isinstance(table, list):
        store["statsTable"]["nameCodes"] = [str(code) for code in table]

    store["updatedAt"] = raw.get("updatedAt") if isinstance(raw.get("updatedAt"), str) else None
    return store


# ── 读 / 写 ──────────────────────────────────────────────────────────

def _read(path: Path) -> dict:
    if not path.is_file():
        return default_store()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        # 存档坏了不能让所有命令打不开：退回空档，但把现场留在日志里，
        # 用户还可以拿备份文件顶回来（文件名没被覆盖，只是暂时读不动）
        logger.error("[%s] 存档解析失败，本次按空存档处理：%s（%r）", paths.PLUGIN_NAME, path, exc)
        return default_store()
    return _normalize(raw)


def _write(path: Path, store: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load(uid) -> dict:
    """读某 QQ 的存档。文件不存在时返回默认档（**不落盘**，避免刷出一堆空文件）。"""
    path = user_store_path(uid)
    with _lock_for(path):
        return _read(path)


def update(uid, mutator):
    """加锁 → 读 → ``mutator(store)`` → 写 → 返回 mutator 的返回值。

    mutator 抛异常时不写盘（校验失败不该把半截改动存进去）。
    """
    path = user_store_path(uid)
    with _lock_for(path):
        store = _read(path)
        result = mutator(store)
        store["updatedAt"] = _stamp()
        _write(path, store)
        return result


# ── 存档内的操作（都在 update 的 mutator 里用） ───────────────────────

def record_of(store: dict, name_code) -> dict | None:
    return store["characters"].get(str(name_code))


def update_record(store: dict, name_code, changes: dict) -> dict:
    """改一个角色。``changes`` 里是字典的键做一层合并（如 ``{"skills": {"skill1": 10}}``）。

    角色不在存档里就抛 :class:`StoreError`：BOT 建不出装备词条，
    凭空造一条半残记录只会让卡片全是「—」，不如让用户先去网页端导出。
    """
    record = record_of(store, name_code)
    if record is None:
        raise StoreError(f"存档里还没有 {name_code} 的数据")
    for key, value in changes.items():
        current = record.get(key)
        if isinstance(value, dict) and isinstance(current, dict):
            record[key] = {**current, **value}
        else:
            record[key] = value
    record["updatedAt"] = _stamp()
    return record


def update_all_records(store: dict, changes: dict) -> int:
    """把所有**已导入**的角色都改一遍，返回改了几个。

    仅限已导入的角色：一键命令不该凭空给图鉴里 200 个角色各建一份记录。
    """
    for name_code in list(store["characters"]):
        record = store["characters"][name_code]
        for key, value in changes.items():
            current = record.get(key)
            if isinstance(value, dict) and isinstance(current, dict):
                record[key] = {**current, **value}
            else:
                record[key] = value
        record["updatedAt"] = _stamp()
    return len(store["characters"])


def set_synchro_level(store: dict, level: int) -> tuple[int, int]:
    """设同步器等级（存档级全局唯一）。返回 ``(旧值, 新值)``。"""
    if not SYNCHRO_MIN <= level <= SYNCHRO_MAX:
        raise StoreError(f"同步器等级要在 {SYNCHRO_MIN}~{SYNCHRO_MAX} 之间")
    old = store["synchroLevel"]
    store["synchroLevel"] = level
    return old, level


# ── 分享码合并 ───────────────────────────────────────────────────────

def _merge_keep(record: dict, incoming: dict) -> None:
    """只覆盖 incoming 里**真正带了值**的字段。

    ``None`` 是「导出时这项没填」，不是「要把它改成空」——
    比如网页端没填星级，分享码里是哨兵值，解出来就是 ``None``，
    这时必须保留 BOT 里已有的星级，而不是抹掉。
    """
    for key, value in incoming.items():
        if value is None:
            continue
        current = record.get(key)
        if isinstance(value, dict) and isinstance(current, dict):
            for sub_key, sub_value in value.items():
                if sub_value is not None:
                    current[sub_key] = sub_value
            continue
        record[key] = value


def _fresh_record(incoming: dict) -> dict:
    """新角色：未导出的字段套用协议默认值。

    不这么做的话，一个只勾了装备词条的分享码导进来，卡片上好感度 / 技能 /
    魔方全是「—」，看起来像坏了；协议早就为这种情况定义了默认值。
    """
    record = apply_defaults(copy.deepcopy(incoming))
    record["updatedAt"] = _stamp()
    return record


def merge_share_result(store: dict, result: dict) -> dict:
    """把解码出的分享码并进存档。两种载荷都走这里。

    返回给用户看的摘要：``{"kind", "added", "updated", "rows", "synchroLevel"}``
    """
    if result.get("payloadType") == PAYLOAD_TABLE:
        name_codes = [str(code) for code in (result.get("nameCodes") or [])]
        store["statsTable"]["nameCodes"] = name_codes
        return {"kind": "table", "rows": name_codes, "added": [], "updated": []}

    characters = result.get("characters") or {}
    added: list[str] = []
    updated: list[str] = []
    for name_code, incoming in characters.items():
        code = str(name_code)
        existing = store["characters"].get(code)
        if existing is None:
            store["characters"][code] = _fresh_record(incoming)
            added.append(code)
        else:
            _merge_keep(existing, incoming)
            existing["updatedAt"] = _stamp()
            updated.append(code)

    # 同步器等级是存档级、全局唯一，分享码里恒带，直接采用
    level = result.get("synchroLevel")
    if isinstance(level, int) and not isinstance(level, bool) and SYNCHRO_MIN <= level <= SYNCHRO_MAX:
        store["synchroLevel"] = level

    # 研究等级也恒为存档级，但**只有码里带了才覆盖**（没带就保留 BOT 里已有的）
    if "research" in (result.get("fields") or []):
        store["research"] = normalize_research(result.get("research"))

    return {
        "kind": "characters",
        "added": added,
        "updated": updated,
        "synchroLevel": store["synchroLevel"],
        "fields": list(result.get("fields") or []),
    }


def set_table_config(store: dict, name_codes: list[str]) -> list[str]:
    cleaned = [str(code) for code in name_codes]
    store["statsTable"]["nameCodes"] = cleaned
    return cleaned
