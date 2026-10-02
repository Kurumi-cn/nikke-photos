"""角色卡模块开关与版式常量，对应网页端 ``app/src/lib/cardLayout.js``。"""
from __future__ import annotations

CARD_WIDTH = 736
CARD_HEIGHT = 1096

#: 10 个可开关模块，顺序与网页端右栏「模块」区块一致
MODULE_OPTIONS = [
    ("favoriteItem", "收藏品"),
    ("rarity", "稀有度/突破"),
    ("levelName", "等级/名称"),
    ("affection", "好感度"),
    ("combat", "战斗力"),
    ("metadata", "属性图标"),
    ("skills", "技能等级"),
    ("cube", "魔方"),
    ("affixSummary", "词条合计"),
    ("equipments", "四件装备"),
]

DEFAULT_MODULES = {key: True for key, _label in MODULE_OPTIONS}


def default_modules() -> dict:
    return dict(DEFAULT_MODULES)


def normalize_modules(value) -> dict:
    """把外部传入的模块开关补齐成完整的 10 项（缺的按默认 True）。"""
    if not isinstance(value, dict):
        return default_modules()
    return {key: bool(value.get(key, True)) for key, _label in MODULE_OPTIONS}
