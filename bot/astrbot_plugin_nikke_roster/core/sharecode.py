"""NKP2 分享码解码（变体 A4）。

协议权威说明见 ``文档/NKP2-A4-协议.md``；网页端编码实现在
``app/src/lib/shareCode.js``，本模块是它逐字段对应的 Python 解码端。

    >>> decode_share_code("NKP2:...")
    {'version': 2, 'payloadType': 0, 'fields': [...], 'synchroLevel': 200, ...}

两种载荷共用一条命令导入，靠 ``payloadType`` 自动分派：

* ``0`` 角色数据 —— 带练度明细（装备词条必选，其余 7 项可勾）
* ``1`` 表格配置 —— **只带角色名单与行序**，练度数据由 BOT 从该 QQ 自己的
  存档里取（相当于「只调个兵」）

与 A3 不兼容（A3 已废弃）：版本号必须完全一致才解析。布局改过，硬解析会解出
垃圾数据，宁可明确报「版本不一致，请重新导出」。
"""
from __future__ import annotations

import base64
import struct
import zlib

from .gamedata import AFFIX_TYPES, CUBE_IDS, FAVORITE_KEYS, affix_tier_value

# ── 协议常量（改这里必须同步改 shareCode.js 与协议文档） ──────────────
SHARE_VERSION = 2
SHARE_VERSION_TEXT = "0.2"

PAYLOAD_CHARACTERS = 0
PAYLOAD_TABLE = 1

SHARE_MAX_COUNT = 10
TABLE_MAX_COUNT = 255

#: 可导出字段：(key, 掩码位, 界面名称)；equip 恒为必选
SHARE_FIELDS = [
    ("equip", 0, "装备词条"),
    ("research", 1, "研究等级"),
    ("skills", 2, "技能等级"),
    ("cube", 3, "魔方"),
    ("favorite", 4, "收藏品"),
    ("limitBreak", 5, "星级 / 突破"),
    ("affection", 6, "好感度"),
    ("combat", 7, "战斗力"),
]
LOCKED_FIELD = "equip"

FAVORITE_TYPE_R = 1
FAVORITE_TYPE_SR = 2
FAVORITE_TYPE_BASE = 3

#: 未导出字段的默认值，``apply_defaults`` 照此填充
SHARE_DEFAULTS = {
    "grade": 3,
    "core": 7,
    "affection": 30,
    "combat": 114514,
    "skill": 10,
    "cube": 10003,          # 遗迹巨熊魔方
    "cubeLevel": 15,
    "favoriteRarity": "SR",
    "favoriteLevel": 15,
    "research": 200,
}

# ── 位宽与哨兵 ───────────────────────────────────────────────────────
# 角色 id 13 bit 直接写 nameCode 原值；8190/8191 留给没有数字 id 的国服独占角色
_W = {
    "id": 13, "grade": 3, "core": 4, "affection": 6, "combat": 22,
    "skill": 4, "cubeType": 5, "cubeLevel": 4, "favoriteType": 5, "favoriteLevel": 4,
    "affixType": 4, "affixTier": 4, "research": 10,
}
_SENTINEL = {"grade": 7, "core": 15, "affection": 41}
_SENTINEL_CHAR_IDS = {8190: "cn-exclusive-huapi", 8191: "cn-exclusive-yingning"}

#: 研究等级在线上的顺序：先企业 5 个、后职业 3 个
WIRE_RESEARCH = [
    ("corporation", "ELYSION"), ("corporation", "MISSILIS"), ("corporation", "TETRA"),
    ("corporation", "PILGRIM"), ("corporation", "ABNORMAL"),
    ("class", "Attacker"), ("class", "Defender"), ("class", "Supporter"),
]

_PREFIX = "NKP2:"


class ShareCodeError(ValueError):
    """分享码不可用。消息可以直接回给用户。"""


class _BitReader:
    """MSB-first 位读取器。越界即判定分享码不完整。"""

    __slots__ = ("data", "pos")

    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def read(self, width: int) -> int:
        value = 0
        for _ in range(width):
            index = self.pos >> 3
            if index >= len(self.data):
                raise ShareCodeError("分享码内容不完整")
            value = (value << 1) | ((self.data[index] >> (7 - (self.pos & 7))) & 1)
            self.pos += 1
        return value


def _open(text: str) -> bytes:
    """剥前缀、base64url 解码、校验 CRC32，返回去掉 CRC 的字节流。"""
    token = str(text or "").strip().replace("\n", "").replace(" ", "")
    if not token.startswith(_PREFIX):
        raise ShareCodeError("分享码格式不正确（应以 NKP2: 开头）")
    body64 = token[len(_PREFIX):]
    try:
        payload = base64.urlsafe_b64decode(body64 + "=" * (-len(body64) % 4))
    except Exception as exc:
        raise ShareCodeError("分享码格式不正确（base64 解不开）") from exc
    if len(payload) < 8:
        raise ShareCodeError("分享码内容不完整")
    body, crc = payload[:-4], struct.unpack(">I", payload[-4:])[0]
    if zlib.crc32(body) & 0xFFFFFFFF != crc:
        raise ShareCodeError("分享码已损坏，请重新复制")
    return body


def _read_header(br: _BitReader) -> tuple[int, int, int]:
    version = br.read(16)
    if version != SHARE_VERSION:
        text = f"{version // 100}.{version % 100}"
        raise ShareCodeError(
            f"分享码版本 {text} 与当前版本 {SHARE_VERSION_TEXT} 不一致，请到网页端重新导出"
        )
    return version, br.read(8), br.read(8)


def decode_share_code(text: str) -> dict:
    """解码分享码。返回结构见模块文档字符串。失败抛 :class:`ShareCodeError`。"""
    br = _BitReader(_open(text))
    version, payload_type, count = _read_header(br)

    if payload_type == PAYLOAD_TABLE:
        if count == 0:
            raise ShareCodeError("分享码内容不完整")
        name_codes = []
        for _ in range(count):
            wire = br.read(_W["id"])
            name_codes.append(_SENTINEL_CHAR_IDS.get(wire) or str(wire))
        return {"version": version, "payloadType": PAYLOAD_TABLE, "nameCodes": name_codes}

    if payload_type != PAYLOAD_CHARACTERS:
        raise ShareCodeError(f"不认识的分享码类型：{payload_type}")
    if count == 0 or count > SHARE_MAX_COUNT:
        raise ShareCodeError("分享码内容不完整")

    mask = br.read(8)
    fields = [key for key, bit, _label in SHARE_FIELDS if mask & (1 << bit)]
    has = set(fields)
    synchro_level = br.read(16)

    research: dict[str, dict] = {"corporation": {}, "class": {}}
    if "research" in has:
        for group, key in WIRE_RESEARCH:
            research[group][key] = br.read(_W["research"])

    characters: dict[str, dict] = {}
    for _ in range(count):
        wire_id = br.read(_W["id"])
        name_code = _SENTINEL_CHAR_IDS.get(wire_id) or str(wire_id)
        characters[name_code] = _read_record(br, has)

    return {
        "version": version,
        "payloadType": PAYLOAD_CHARACTERS,
        "fields": fields,
        "synchroLevel": synchro_level,
        "research": research,
        "characters": characters,
    }


def _read_record(br: _BitReader, has: set[str]) -> dict:
    record: dict = {}

    if "limitBreak" in has:
        grade = br.read(_W["grade"])
        core = br.read(_W["core"])
        record["limitBreak"] = {
            "grade": None if grade == _SENTINEL["grade"] else grade,
            "core": None if core == _SENTINEL["core"] else core,
        }
    if "affection" in has:
        affection = br.read(_W["affection"])
        record["affection"] = None if affection == _SENTINEL["affection"] else affection
    if "combat" in has:
        combat = br.read(_W["combat"])
        record["combat"] = None if combat == 0 else combat
    if "skills" in has:
        values = [br.read(_W["skill"]) for _ in range(3)]
        record["skills"] = {
            "skill1": values[0] or None,
            "skill2": values[1] or None,
            "burst": values[2] or None,
        }
    if "cube" in has:
        cube_type = br.read(_W["cubeType"])
        cube_level = br.read(_W["cubeLevel"])
        record["cube"] = None if cube_type == 0 else {
            "resourceId": CUBE_IDS[cube_type - 1] if cube_type - 1 < len(CUBE_IDS) else None,
            "level": cube_level or None,
        }
    if "favorite" in has:
        fav_type = br.read(_W["favoriteType"])
        fav_level = br.read(_W["favoriteLevel"])
        if fav_type == 0 or fav_level == 0:
            record["favoriteItem"] = None
        elif fav_type in (FAVORITE_TYPE_R, FAVORITE_TYPE_SR):
            record["favoriteItem"] = {
                "rarity": "R" if fav_type == FAVORITE_TYPE_R else "SR",
                "level": fav_level,
                "resourceKey": None,
            }
        else:
            index = fav_type - FAVORITE_TYPE_BASE
            record["favoriteItem"] = {
                "rarity": "SSR",
                "resourceKey": FAVORITE_KEYS[index] if 0 <= index < len(FAVORITE_KEYS) else None,
                # 线上传的是界面值（1-3），落回 App 内部表示（0-2）
                "level": fav_level - 1,
            }
    if "equip" in has:
        slots = []
        for _slot in range(4):
            lines = []
            for _line in range(3):
                affix_type = br.read(_W["affixType"])
                tier = br.read(_W["affixTier"])
                if affix_type == 0 or tier == 0 or affix_type > len(AFFIX_TYPES):
                    lines.append(None)
                else:
                    function_type = AFFIX_TYPES[affix_type - 1]
                    lines.append({
                        "functionType": function_type,
                        "level": tier,
                        # 词条数值不传输，由「类型 + 档位」查表推出（与网页端一致）
                        "value": affix_tier_value(function_type, tier),
                    })
            slots.append(lines)
        record["equipments"] = slots

    return record


def apply_defaults(record: dict) -> dict:
    """把未导出 / 哨兵字段按协议默认值补齐（就地修改并返回）。

    只在需要「完整档案」时调用（例如存进 BOT 的练度库）。
    想区分「用户填了 3 星」和「没导出星级」时不要调，直接读 None。
    """
    limit_break = record.setdefault("limitBreak", {})
    if limit_break.get("grade") is None:
        limit_break["grade"] = SHARE_DEFAULTS["grade"]
    if limit_break.get("core") is None:
        limit_break["core"] = SHARE_DEFAULTS["core"]

    if record.get("affection") is None:
        record["affection"] = SHARE_DEFAULTS["affection"]
    if record.get("combat") is None:
        record["combat"] = SHARE_DEFAULTS["combat"]

    skills = record.setdefault("skills", {})
    for key in ("skill1", "skill2", "burst"):
        if skills.get(key) is None:
            skills[key] = SHARE_DEFAULTS["skill"]

    if record.get("cube") is None:
        record["cube"] = {"resourceId": SHARE_DEFAULTS["cube"], "level": SHARE_DEFAULTS["cubeLevel"]}

    if record.get("favoriteItem") is None:
        record["favoriteItem"] = {
            "rarity": SHARE_DEFAULTS["favoriteRarity"],
            "level": SHARE_DEFAULTS["favoriteLevel"],
            "resourceKey": None,
        }

    # 装备词条恒为必选，缺位只在「该行本来就没词条」时出现，不需要填默认值
    record.setdefault("equipments", [[None, None, None] for _ in range(4)])
    return record


def describe_payload(result: dict) -> str:
    """给用户看的一行摘要，用于导入回执。"""
    if result.get("payloadType") == PAYLOAD_TABLE:
        return f"表格配置（{len(result.get('nameCodes') or [])} 行）"
    count = len(result.get("characters") or {})
    return f"角色数据（{count} 个角色）"
