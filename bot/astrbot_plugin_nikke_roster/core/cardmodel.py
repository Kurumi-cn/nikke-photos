"""角色卡的展示模型：与网页端 ``app/src/lib/cardModel.js`` 一一对应。

为什么要单独一层：出图模块只关心「画什么」，不关心「数据从哪来」。
把 model 和 drawing 分开，网页端改了规则时，照着 JS 改这里就行，不用碰版式代码。
"""
from __future__ import annotations

import math

from . import gamedata

SLOT_KEYS = gamedata.SLOT_KEYS
SLOT_LABELS = gamedata.SLOT_LABELS

# 装备类型固定为「过载 T10」（本工具只处理改造装备，类型不可选）
EQUIPMENT_TIER_LABEL = "T10"


def to_number(value):
    """与 JS 版 toNumber 一致：空值/布尔/空串 → None，非法数字 → None。

    ⚠️ 不要直接 float(None)：Number(null) === 0 会让「没填」变成「填了 0」。
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str) and not value.strip():
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def to_int(value):
    number = to_number(value)
    return None if number is None else math.trunc(number)


def format_percent(value) -> str:
    number = to_number(value)
    return "—" if number is None else f"{number:.2f}%"


def format_core_badge(core) -> str:
    """核心数 → 徽章文字：0 → 空，1~6 → 两位补零，≥7 → MAX。"""
    value = max(0, math.trunc(to_number(core) or 0))
    if value >= 7:
        return "MAX"
    return f"{value:02d}" if value > 0 else ""


def favorite_item_stars(rarity, level) -> int:
    """普通收藏品 = ceil(等级/5)，SSR 珍藏品 = 等级 + 1（0~3 星）。"""
    normalized = max(0, math.trunc(to_number(level) or 0))
    if str(rarity or "").strip().upper() == "SSR":
        return min(3, normalized + 1)
    return min(3, math.ceil(normalized / 5))


def normalize_equipments(equipments) -> list[list[dict | None]]:
    """4 件装备 × 每件 3 条词条；按 position 归位，重复 position 只取第一条。"""
    result: list[list[dict | None]] = []
    for slot in range(4):
        source = equipments[slot] if isinstance(equipments, (list, tuple)) and slot < len(equipments) else None
        source = source if isinstance(source, (list, tuple)) else []
        by_position: dict[int, dict] = {}
        for index, line in enumerate(source):
            if not isinstance(line, dict) or not line.get("functionType"):
                continue
            position = to_int(line.get("position")) or (index + 1)
            if position in by_position:
                continue
            function_type = str(line["functionType"])
            by_position[position] = {
                "functionType": function_type,
                "label": gamedata.affix_label(function_type),
                "value": to_number(line.get("value")),
                "level": to_number(line.get("level")),
            }
        result.append([by_position.get(index + 1) for index in range(3)])
    return result


def summarize_affixes(equipments, limit: int = 3) -> list[dict]:
    """词条合计：按类型汇总档位与百分比，按总档位降序取前 N 条。

    档位并列时按「该词条在装备栏首次出现的顺序」排列（与网页端一致）。
    """
    totals: dict[str, dict] = {}
    order = 0
    for slot in normalize_equipments(equipments):
        for line in slot:
            if not line:
                continue
            level = line.get("level")
            if level is None or level <= 0:
                continue
            function_type = line["functionType"]
            current = totals.get(function_type)
            if current is not None:
                current["totalLevel"] += level
                if line.get("value") is not None:
                    current["valueHundredths"] += round(line["value"] * 100)
                else:
                    current["completeValue"] = False
                continue
            totals[function_type] = {
                "functionType": function_type,
                "label": line["label"],
                "totalLevel": level,
                "valueHundredths": round(line["value"] * 100) if line.get("value") is not None else 0,
                "completeValue": line.get("value") is not None,
                "order": order,
            }
            order += 1

    ordered = sorted(totals.values(), key=lambda item: (-item["totalLevel"], item["order"]))
    return [
        {**item, "totalValue": item["valueHundredths"] / 100 if item["completeValue"] else None}
        for item in ordered[: max(0, limit)]
    ]


def resolve_artwork(character: dict, artwork_id: str | None = None) -> dict | None:
    """取立绘：优先指定 id，其次 default，最后第一个。"""
    artworks = [a for a in (character.get("artworks") or []) if isinstance(a, dict) and a.get("file")]
    if not artworks:
        return None
    if artwork_id:
        for item in artworks:
            if item.get("id") == artwork_id:
                return item
    for item in artworks:
        if item.get("id") == "default":
            return item
    return artworks[0]


def build_card_data(character: dict, record: dict | None, *, synchro_level=None, research=None) -> dict:
    """组装卡片展示模型。

    synchro_level / research 是存档级数据（全局唯一 / 按职业与企业查表），
    优先于记录里的同名遗留字段 —— 与网页端 buildCardData 的优先级一致。
    """
    data = record or {}
    equipments = normalize_equipments(data.get("equipments"))

    favorite_rarity = str((data.get("favoriteItem") or {}).get("rarity") or "").strip().upper()
    favorite_level = to_number((data.get("favoriteItem") or {}).get("level"))
    is_favorite_ssr = favorite_rarity == "SSR"
    has_favorite = bool(favorite_rarity) or favorite_level is not None
    favorite_stars = favorite_item_stars(favorite_rarity, favorite_level) if has_favorite else None
    if has_favorite:
        icon = (character.get("favoriteItem") or {}).get("icon") if is_favorite_ssr else None
        favorite_asset = icon or gamedata.doll_asset_for_weapon(character.get("weapon_type"))
    else:
        favorite_asset = ""

    skill_icons = character.get("skillIcons") or {}
    skill_levels = {
        "skill1": (data.get("skills") or {}).get("skill1"),
        "skill2": (data.get("skills") or {}).get("skill2"),
        "burst": (data.get("skills") or {}).get("burst"),
    }
    skills = []
    for key in ("skill1", "skill2", "burst"):
        level = to_number(skill_levels[key])
        url = skill_icons.get(key) or ""
        if url and level is not None and 1 <= level <= 10:
            skills.append({
                "key": key,
                "label": "爆裂技能" if key == "burst" else f"技能 {1 if key == 'skill1' else 2}",
                "url": url,
                "level": int(level),
            })

    cube_source = data.get("cube") or {}
    cube_level = to_number(cube_source.get("level"))
    cube = None
    if cube_source.get("resourceId") or cube_level is not None:
        resource_id = to_int(cube_source.get("resourceId"))
        cube = {
            "resourceId": resource_id,
            "name": gamedata.cube_name(resource_id),
            "asset": gamedata.cube_icon_asset(resource_id),
            "level": None if cube_level is None else int(cube_level),
        }

    class_level = (research or {}).get("class", {}).get(character.get("class"))
    if class_level is None:
        class_level = data.get("classLevel")
    corporation_level = (research or {}).get("corporation", {}).get(character.get("corporation"))
    if corporation_level is None:
        corporation_level = data.get("corporationLevel")

    limit_break = data.get("limitBreak") or {}
    grade = to_int(limit_break.get("grade"))
    return {
        "nameCode": str(character.get("nameCode")),
        "name": character.get("nameCn") or "",
        "rarity": character.get("original_rare") or "",
        "rarityAsset": gamedata.rarity_asset(character.get("original_rare")),
        "level": to_int(synchro_level) if to_number(synchro_level) is not None else to_int(data.get("level")),
        "limitBreak": {
            "grade": min(3, max(0, grade or 0)),
            "core": limit_break.get("core"),
            "coreBadge": format_core_badge(limit_break.get("core")),
        },
        "affection": to_int(data.get("affection")),
        "combat": to_int(data.get("combat")),
        "classLevel": to_int(class_level) if class_level is not None else None,
        "corporationLevel": to_int(corporation_level) if corporation_level is not None else None,
        "favoriteItem": {
            "rarity": favorite_rarity,
            "level": favorite_level,
            "stars": favorite_stars,
            "asset": favorite_asset,
            "isFavorite": is_favorite_ssr,
        } if has_favorite else None,
        "skills": skills,
        "cube": cube,
        "element": character.get("element"),
        "className": character.get("class"),
        "burstStage": character.get("use_burst_skill"),
        "corporation": character.get("corporation"),
        "weaponType": character.get("weapon_type"),
        "equipments": equipments,
        "equipmentDisplays": [
            {
                "state": "known",
                "icon": gamedata.overload_icon_asset(character.get("class"), SLOT_KEYS[index]),
                "tier": EQUIPMENT_TIER_LABEL,
                "isOverload": True,
                "className": character.get("class"),
                "manufacturer": "",
                "label": f"{SLOT_LABELS[index]} · {EQUIPMENT_TIER_LABEL}",
            }
            for index in range(4)
        ],
        "topAffixes": summarize_affixes(equipments, 3),
    }
