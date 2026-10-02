"""角色索引：把 roster.json 读成「随便打一个名字 → 角色记录」的查表结构。

三件事
------
1. ``nameCode`` → 角色记录。出图、存档、分享码全都以 nameCode 为准。
2. 名字解析。BOT 命令里到处是「角色」参数，用户会写全名、俗称、英文名或拼音，
   这里统一收口成一次查表。
3. 别名表 ``aliases.json`` **每次读盘**（用户用 FinalShell 改完立刻生效，
   不做缓存，也不写回 roster.json）。

别名表格式（key = nameCode，name 仅用于校验，对不上会在日志里告警）::

    {
      "5061": {"name": "桃乐丝", "aliases": ["桃子", "DORO"]},
      "cn-exclusive-huapi": {"name": "花皮", "aliases": []}
    }

为什么以 nameCode 为 key 而不是中文名：中文名可能随版本微调（补字、改译名），
nameCode 是稳定的；name 只当「你改错了行」的提示。
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path

from . import paths
from .log import logger

# 别名表里 name 与 roster 不一致时只告警，不影响功能


def normalize(text) -> str:
    """把查询词归一化：全角转半角、去空白、转小写。

    NFKC 会把全角冒号 ``：``、全角字母数字都折成半角，省得用户切输入法。
    别名表和角色名走同一套归一化，两边才可能对上。
    """
    s = unicodedata.normalize("NFKC", str(text or ""))
    return "".join(s.split()).lower()


class Roster:
    """角色表 + 名字解析器。进程内只建一次，别名表则每次解析时重读。"""

    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else paths.ROSTER_FILE
        self.revision: str = ""
        self.characters: list[dict] = []
        self.by_code: dict[str, dict] = {}
        # 归一化名字 → nameCode。插入顺序即优先级：后插入的覆盖先插入的，
        # 所以按「英文名 → 拼音 → roster 自带别名 → 中文名」的顺序写入，
        # 中文名优先于其它来源。
        self._index: dict[str, str] = {}
        self._load()

    # ---------------------------------------------------------------- 装载
    def _load(self) -> None:
        with open(self.path, encoding="utf-8") as f:
            raw = json.load(f)
        self.revision = str(raw.get("revision") or "")
        characters = raw.get("characters")
        if not isinstance(characters, list) or not characters:
            raise ValueError(f"角色表为空或格式不对：{self.path}")
        self.characters = [c for c in characters if c.get("nameCode")]
        for char in self.characters:
            self.by_code[str(char["nameCode"])] = char
        self._build_index()

    def _build_index(self) -> None:
        self._index.clear()
        for char in self.characters:
            code = str(char["nameCode"])
            for key in (char.get("nameEn"), char.get("pinyin")):
                self._put(key, code)
            for alias in char.get("aliases") or []:
                self._put(alias, code)
            self._put(char.get("nameCn"), code)

    def _put(self, key, code: str) -> None:
        normalized = normalize(key)
        if normalized:
            self._index[normalized] = code

    # ------------------------------------------------------------ 别名表
    def load_aliases(self) -> dict[str, list[str]]:
        """读别名表，返回 ``{nameCode: [别名...]}``。

        文件不存在时返回空表（不是错误——首次部署本来就没有）。
        格式不对时告警并返回空表：别名只是「方便」，
        不该因为它写坏了就让所有指令打不开。

        **只在本角色内部去重**，不做跨角色的全局去重：两个角色共用一个俗称时
        （例如「绫波丽」同时挂在「零」和「零（暂称）」上），应该由 :meth:`resolve`
        报「歧义、请说清楚是哪个」，而不是静默让后一个角色丢别名。
        """
        path = paths.aliases_path()
        if not path.is_file():
            return {}
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("[%s] 别名表解析失败（%s）：%r", paths.PLUGIN_NAME, path, exc)
            return {}
        if not isinstance(raw, dict):
            logger.warning("[%s] 别名表应为对象，实际是 %s", paths.PLUGIN_NAME, type(raw).__name__)
            return {}

        result: dict[str, list[str]] = {}
        for code, entry in raw.items():
            code = str(code)
            if code.startswith("_"):
                # 以 _ 开头的 key 是留给用户写备注的（种子文件里的 _help 就是一例）
                continue
            if isinstance(entry, list):          # 容错：直接写数组也认
                aliases, declared = entry, ""
            elif isinstance(entry, dict):
                aliases, declared = entry.get("aliases") or [], str(entry.get("name") or "")
            else:
                continue
            char = self.by_code.get(code)
            if char is None:
                logger.warning("[%s] 别名表里的 %s 不在角色表中，已忽略", paths.PLUGIN_NAME, code)
                continue
            if declared and normalize(declared) != normalize(char.get("nameCn")):
                logger.warning(
                    "[%s] 别名表 %s 写的是「%s」，角色表里是「%s」——请确认有没有改错行",
                    paths.PLUGIN_NAME, code, declared, char.get("nameCn"),
                )
            cleaned: list[str] = []
            local: set[str] = set()
            for alias in aliases:
                key = normalize(alias)
                if not key or key in local:
                    continue
                local.add(key)
                cleaned.append(str(alias))
            if cleaned:
                result[code] = cleaned
        return result

    def alias_owners(self) -> dict[str, list[str]]:
        """归一化别名 → 拥有它的 nameCode 列表（用于判断歧义）。"""
        owners: dict[str, list[str]] = {}
        for code, aliases in self.load_aliases().items():
            for alias in aliases:
                key = normalize(alias)
                if key and code not in owners.setdefault(key, []):
                    owners[key].append(code)
        return owners

    # -------------------------------------------------------------- 解析
    def by_name_code(self, code) -> dict | None:
        return self.by_code.get(str(code))

    def resolve(self, query: str) -> tuple[dict | None, list[dict]]:
        """解析用户输入的角色名。

        返回 ``(命中角色, 歧义候选)``：
          · 唯一命中 → ``(角色, [])``
          · 完全没命中 → ``(None, [])``
          · 命中多个（只在模糊匹配阶段可能发生）→ ``(None, [候选...])``

        匹配优先级：nameCode → 用户别名表 → 中文名/英文名/拼音（roster 自带）
        → 中文名子串、拼音前缀。

        一个别名被多个角色认领时（用户手写重了）返回候选列表，让调用方
        提示「说清楚是哪个」，而不是随便挑一个。
        """
        text = str(query or "").strip()
        if not text:
            return None, []

        # 1) 直接给 nameCode（含国服独占的 cn-exclusive-* 两键）
        direct = self.by_code.get(text)
        if direct is not None:
            return direct, []

        key = normalize(text)

        # 2) 用户别名表：手写的，意图最明确，优先级高于角色表自带的字段
        owners = self.alias_owners().get(key)
        if owners:
            if len(owners) == 1:
                return self.by_code[owners[0]], []
            return None, [self.by_code[code] for code in owners]

        # 3) 角色表自带：中文名 / 英文名 / 拼音 / 上游别名
        code = self._index.get(key)
        if code:
            return self.by_code[code], []

        # 4) 模糊：中文名/英文名包含查询词，或拼音以查询词开头
        hits: list[dict] = []
        for char in self.characters:
            names = [char.get("nameCn"), char.get("nameEn")]
            if any(key in normalize(n) for n in names if n):
                hits.append(char)
                continue
            pinyin = normalize(char.get("pinyin"))
            if pinyin and pinyin.startswith(key):
                hits.append(char)
        if len(hits) == 1:
            return hits[0], []
        if len(hits) > 1:
            return None, hits[:8]
        return None, []

    # ------------------------------------------------------------ 出图辅助
    @staticmethod
    def artworks(char: dict) -> list[dict]:
        items = char.get("artworks")
        return [a for a in items if isinstance(a, dict) and a.get("file")] if items else []

    @classmethod
    def default_artwork(cls, char: dict) -> str:
        """默认立绘的相对路径（无 artwork 时返回空串）。"""
        items = cls.artworks(char)
        for item in items:
            if item.get("id") == "default":
                return f"ui-assets/nikke/character-artwork/{item['file']}"
        return f"ui-assets/nikke/character-artwork/{items[0]['file']}" if items else ""

    # -------------------------------------------------------------- 自检
    def summary(self) -> dict:
        return {
            "revision": self.revision,
            "characters": len(self.characters),
            "index": len(self._index),
            "cnAvailable": sum(1 for c in self.characters if c.get("cnAvailable")),
            "collectibleCn": sum(1 for c in self.characters if c.get("collectibleCn")),
        }


_CACHED: Roster | None = None


def load(force: bool = False) -> Roster:
    """取进程内的角色表（首次调用时读盘）。"""
    global _CACHED
    if _CACHED is None or force:
        _CACHED = Roster()
        logger.info(
            "[%s] 角色表已加载：%s 个角色，索引 %s 条（revision %s）",
            paths.PLUGIN_NAME,
            _CACHED.summary()["characters"],
            _CACHED.summary()["index"],
            _CACHED.revision or "未知",
        )
    return _CACHED
