"""游戏数据表：冻结字典、词条档位、中文标签、素材路径解析。

对应网页端的 ``app/src/data/affixTiers.js`` 与 ``app/src/lib/cardAssets.js``。

⚠️ ``AFFIX_TYPES`` / ``CUBE_IDS`` / ``FAVORITE_KEYS`` 三张表的顺序是
**协议冻结**的（NKP2 分享码按序号传输），只能往后追加，绝不重排、绝不删除，
否则历史分享码会解成别的道具。
其余表（标签、素材路径）属于展示层，随时可以改。
"""
from __future__ import annotations

import json
import threading

from . import paths

# ── 冻结字典 ─────────────────────────────────────────────────────────
# 词条类型（序号 0-8，线上写序号+1，0 保留给空行）
AFFIX_TYPES = [
    "IncElementDmg", "StatAtk", "StatAmmoLoad", "StatChargeTime", "StatChargeDamage",
    "StatCritical", "StatCriticalDamage", "StatAccuracyCircle", "StatDef",
]

# 魔方（序号 0-16，线上写序号+1，0 保留给「无魔方」）。resourceId 不连续，必须显式列出。
CUBE_IDS = [
    10001, 10002, 10003, 10004, 10005, 10006, 11001, 13001, 12001,
    13002, 12002, 10009, 10007, 10008, 10010, 10012, 10013,
]

# 珍藏品（序号 0-20，线上写序号+3，0/1/2 留给 无/R/SR）
FAVORITE_KEYS = [
    "c030", "c032", "c072", "c080", "c100", "c101", "c112", "c140", "c141", "c142", "c150",
    "c170", "c192", "c210", "c280", "c281", "c352", "c390", "c411", "c550", "c580",
]

# ── 词条档位表 ───────────────────────────────────────────────────────
# 档位编号 1~15 对应数组下标 0~14，数组值为百分比数值（9.54 表示 9.54%）
COMMON_TIERS = [4.77, 5.47, 6.18, 6.88, 7.59, 8.29, 9.00, 9.70, 10.40, 11.11, 11.81, 12.52, 13.22, 13.93, 14.63]

AFFIX_LABELS = {
    "IncElementDmg": "优越代码伤害增加",
    "StatAtk": "攻击力增加",
    "StatAmmoLoad": "最大装弹数增加",
    "StatChargeTime": "蓄力速度增加",
    "StatChargeDamage": "蓄力伤害增加",
    "StatCritical": "暴击率增加",
    "StatCriticalDamage": "暴击伤害增加",
    "StatAccuracyCircle": "命中率增加",
    "StatDef": "防御力增加",
}

AFFIX_TIER_VALUES = {
    "IncElementDmg": [9.54, 10.94, 12.34, 13.75, 15.15, 16.55, 17.95, 19.35, 20.75, 22.15, 23.56, 24.96, 26.36, 27.76, 29.16],
    "StatAtk": COMMON_TIERS,
    "StatAmmoLoad": [27.84, 31.95, 36.06, 40.17, 44.28, 48.39, 52.50, 56.60, 60.71, 64.82, 68.93, 73.04, 77.15, 81.26, 85.37],
    "StatChargeTime": [1.98, 2.28, 2.57, 2.86, 3.16, 3.45, 3.75, 4.04, 4.33, 4.63, 4.92, 5.21, 5.51, 5.80, 6.09],
    "StatChargeDamage": COMMON_TIERS,
    "StatCritical": [2.30, 2.64, 2.98, 3.32, 3.66, 4.00, 4.35, 4.69, 5.03, 5.37, 5.71, 6.05, 6.39, 6.73, 7.07],
    "StatCriticalDamage": [6.64, 7.62, 8.60, 9.58, 10.56, 11.54, 12.52, 13.50, 14.48, 15.46, 16.44, 17.42, 18.40, 19.38, 20.36],
    "StatAccuracyCircle": COMMON_TIERS,
    "StatDef": COMMON_TIERS,
}

# ── 展示用标签（与网页端保持一致，出图要显示） ──────────────────────
ELEMENT_LABELS = {"Fire": "燃烧", "Water": "水冷", "Wind": "风压", "Electronic": "电击", "Elect": "电击", "Iron": "铁甲"}
CLASS_LABELS = {"Attacker": "火力型", "Defender": "防御型", "Supporter": "辅助型"}
CORPORATION_LABELS = {
    "ELYSION": "极乐净土", "MISSILIS": "米西利斯", "TETRA": "泰特拉",
    "PILGRIM": "朝圣者", "ABNORMAL": "反常",
}
WEAPON_LABELS = {"AR": "步枪", "MG": "机枪", "RL": "发射器", "SG": "霰弹枪", "SMG": "冲锋枪", "SR": "狙击枪"}
BURST_LABELS = {"Step1": "爆裂 I", "Step2": "爆裂 II", "Step3": "爆裂 III", "AllStep": "爆裂 ALL"}

# ── 素材路径（规则来自 cardAssets.js，素材沿用网页端相对路径） ────────
UI_ROOT = "ui-assets/nikke"

_BURST_ASSET = {"Step1": "burst-1", "Step2": "burst-2", "Step3": "burst-3", "AllStep": "burst-all"}
# 属性图标统一用分类图标素材（public/icons/属性 下同一套 5 个文件）
_ELEMENT_ASSET = {"Fire": "燃烧", "Water": "水冷", "Wind": "风压", "Electronic": "电击", "Elect": "电击", "Iron": "铁甲"}
_WEAPON_ASSET = {"AR": "ar", "MG": "mg", "RL": "rl", "SG": "sg", "SMG": "smg", "SR": "sr"}
_CLASS_ASSET = {"Attacker": "attacker", "Defender": "defender", "Supporter": "supporter"}
_CORPORATION_ASSET = {
    "ELYSION": "elysion", "MISSILIS": "missilis", "TETRA": "tetra",
    "PILGRIM": "pilgrim", "ABNORMAL": "abnormal",
}
# 过载装备图标：职业 → 系列（v金属 / 99 型 / 代号），槽位 head/body/arms/legs
_EQUIPMENT_FAMILY = {"attacker": "vmetal", "defender": "99", "supporter": "code"}
# 收藏品（非 SSR 珍藏品）按武器类型取玩偶图标
_DOLL_BY_WEAPON = {
    "AR": "collectible-ar-cooking.png",
    "SMG": "collectible-smg-coffee.png",
    "MG": "collectible-mg-shopping.png",
    "SG": "collectible-sg-battling.png",
    "SR": "collectible-sr-napping.png",
    "RL": "collectible-rl-exercising.png",
}

SLOT_KEYS = ["head", "body", "arms", "legs"]
SLOT_LABELS = ["头部", "身躯", "臂部", "腿部"]


def affix_label(function_type: str) -> str:
    return AFFIX_LABELS.get(function_type, str(function_type or ""))


def affix_tier_value(function_type: str, tier) -> float | None:
    """档位 → 百分比数值（如 StatAtk 第 7 档 → 9.0）；查不到返回 None。"""
    tiers = AFFIX_TIER_VALUES.get(function_type)
    if not tiers:
        return None
    try:
        index = int(tier)
    except (TypeError, ValueError):
        return None
    return tiers[index - 1] if 1 <= index <= len(tiers) else None


def affix_tier_text(function_type: str, tier) -> str | None:
    """档位 → 百分比文本（如 "9.00%"）。"""
    value = affix_tier_value(function_type, tier)
    return None if value is None else f"{value:.2f}%"


def card_asset(relative: str) -> str:
    return f"{UI_ROOT}/{relative}" if relative else ""


def meta_asset(group: str, value) -> str:
    """元数据图标（爆裂 / 属性 / 武器 / 职业 / 企业）的相对路径，取不到返回空串。"""
    raw = str(value or "").strip()
    if not raw:
        return ""
    if group == "burst":
        return card_asset(f"metadata/native/burst/{_BURST_ASSET[raw]}.png") if raw in _BURST_ASSET else ""
    if group == "element":
        key = _ELEMENT_ASSET.get(raw)
        return f"icons/属性/{key}.webp" if key else ""
    if group == "weapon":
        key = _WEAPON_ASSET.get(raw.upper())
        return card_asset(f"metadata/native/weapon/{key}.png") if key else ""
    if group == "class":
        key = _CLASS_ASSET.get(raw)
        return card_asset(f"metadata/native/class/{key}.png") if key else ""
    if group == "manufacturer":
        key = _CORPORATION_ASSET.get(raw.upper())
        return card_asset(f"metadata/native/manufacturer/{key}.png") if key else ""
    return ""


def rarity_asset(rarity) -> str:
    key = str(rarity or "").strip().lower()
    return card_asset(f"metadata/rarity/{key}.png") if key in ("r", "sr", "ssr") else ""


def overload_icon_asset(class_name, slot_key: str) -> str:
    family = _EQUIPMENT_FAMILY.get(str(class_name or "").strip().lower())
    return card_asset(f"equipment/overload/{family}-{slot_key}.png") if family else ""


def cube_icon_asset(resource_id) -> str:
    return card_asset(f"cubes/ie_{resource_id}.png") if resource_id else ""


def doll_asset_for_weapon(weapon_type) -> str:
    key = str(weapon_type or "").strip().upper()
    name = _DOLL_BY_WEAPON.get(key)
    return card_asset(f"character-card/{name}") if name else ""


def star_asset(filled: bool) -> str:
    return card_asset(f"metadata/breakthrough/{'star-filled' if filled else 'star-empty'}.png")


CORE_FRAME_ASSET = card_asset("metadata/breakthrough/core-frame.png")
OVERLOAD_BADGE_ASSET = card_asset("equipment/overload-badge.png")


def decor_asset(name: str) -> str:
    return card_asset(f"metadata/decorations/{name}.png")


def _asset(relative: str) -> str:
    """头像 / 立绘这类不在 ui-assets 下的路径，原样返回（roster 里已经写好）。"""
    return str(relative or "")


# ── 魔方名（读 assets/data/cubes.json，只读一次） ─────────────────────
_CUBES_LOCK = threading.Lock()
_CUBES: dict[int, dict] | None = None


def cubes() -> dict[int, dict]:
    global _CUBES
    if _CUBES is None:
        with _CUBES_LOCK:
            if _CUBES is None:
                table: dict[int, dict] = {}
                path = paths.asset("data/cubes.json")
                try:
                    raw = json.loads(path.read_text(encoding="utf-8"))
                    for item in raw.get("cubes") or []:
                        if item.get("resourceId") is not None:
                            table[int(item["resourceId"])] = item
                except Exception:
                    table = {}
                _CUBES = table
    return _CUBES


def cube_info(resource_id) -> dict | None:
    try:
        return cubes().get(int(resource_id))
    except (TypeError, ValueError):
        return None


def cube_name(resource_id, fallback: str = "魔方") -> str:
    info = cube_info(resource_id)
    return (info or {}).get("nameCn") or fallback
