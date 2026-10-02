"""角色卡渲染：PIL 手绘 736×1096 版式（默认输出 2x = 1472×2192）。

版式的唯一来源是网页端的 ``app/src/components/card/CharacterCard.jsx`` +
``characterCard.css``。这里逐块对着 CSS 写，注释里标注对应的选择器，
方便将来网页端改版式时同步。

目标是「版式一致、观感接近」，不追求像素级一致：
  · 字体换成观感最接近的自由字体（见 core/imaging.py 的说明）
  · 多层 box-shadow / drop-shadow 用「模糊 alpha 投影」近似
  · 图表上的装饰帧（level-badge / skill-frame / affection-frame / heart）直接贴素材
"""
from __future__ import annotations

import math

from PIL import Image, ImageDraw, ImageFilter

from . import cardlayout, cardmodel, gamedata, imaging, paths

CARD_WIDTH = 736
CARD_HEIGHT = 1096

#: 右栏「布局」滑块的默认值（网页端 CharacterCard.jsx 的 panelScale 同步为 150）
DEFAULT_PANEL_SCALE = 150

# BOT 专属的观感微调（网页端一律按 1× 渲染，不受影响）：
# BOT 出图没有网页端右栏那些滑块，放大倍数只能在这里定死。
#: 左上角收藏品 / 珍藏品块的整体放大倍数
_FAVORITE_SCALE = 1.25
#: 魔方整体放大倍数。魔方素材接近方形、收藏品玩偶是竖长条，两者按同一倍数放大后
#: 魔方仍显小，所以这里给得比收藏品大一档，让视觉尺寸大致对齐。
_CUBE_SCALE = 1.5
#: 左下角技能图标的整体放大倍数（图标框 / 图标本体 / 等级角标 / 间距一起等比缩放）
_SKILL_SCALE = 1.5

_ARTWORK_ROOT = "ui-assets/nikke/character-artwork"

# 颜色（照抄 CSS）
_BG_STOPS = [(0.0, (248, 250, 251)), (0.58, (248, 250, 251)), (0.76, (238, 242, 244)), (1.0, (245, 247, 248))]
_LEVEL_NAME_BG = (52, 55, 58, 255)          # #34373a
_LEVEL_TEXT = (217, 221, 224, 255)           # #d9dde0
_LEVEL_VALUE = (255, 196, 69, 255)           # #ffc445
_AFFIX_LINE_BG = (245, 247, 248, 209)        # rgb(245 247 248 / 82%)
_AFFIX_LINE_15_BG = (36, 36, 36, 255)        # #242424
_AFFIX_TEXT = (52, 57, 62, 255)              # #34393e
_TIER_BLUE = (0, 157, 224, 255)              # #009de0
_TIER15_TEXT = (8, 172, 230, 255)            # #08ace6
_EQUIPMENT_BG = (255, 255, 255, 235)         # rgb(255 255 255 / 92%)
_PANEL_BG = (255, 255, 255, 240)             # rgb(255 255 255 / 94%)
_AFFECTION_TEXT = (240, 68, 77, 255)         # #f0444d
_STAR_BLUE = (59, 143, 210, 255)             # #3b8fd2
_STAR_PURPLE = (148, 71, 201, 255)           # #9447c9
_STAR_ORANGE = (236, 138, 50, 255)           # #ec8a32

# 素材读取与画笔都在 imaging 里（表格渲染也要用同一份缓存）
_load = imaging.load_asset
missing_assets = imaging.missing_assets
_Painter = imaging.Painter


# ── 文本辅助 ─────────────────────────────────────────────────────────

def _advance(fnt, text: str) -> float:
    return fnt.getlength(text)


def _runs_width(runs) -> float:
    return sum(_advance(fnt, text) for text, fnt, _color in runs)


def _runs_ink(runs):
    """返回 (总推进宽度, 墨迹相对起始点的 left/top/right/bottom)。"""
    width = _runs_width(runs)
    cursor = 0.0
    left = top = right = bottom = None
    for text, fnt, _color in runs:
        if text:
            l, t, r, b = fnt.getbbox(text)
            left = (cursor + l) if left is None else min(left, cursor + l)
            right = (cursor + r) if right is None else max(right, cursor + r)
            top = t if top is None else min(top, t)
            bottom = b if bottom is None else max(bottom, b)
        cursor += _advance(fnt, text)
    if left is None:
        return width, 0.0, 0.0, 0.0, 0.0
    return width, left, top, right, bottom


def _draw_runs_center(p: _Painter, cx: float, cy: float, runs):
    """把一组混排文本按**墨迹**居中到 (cx, cy)，返回占用宽度。"""
    runs = [run for run in runs if run[0]] if runs else []
    if not runs:
        return 0.0
    width, left, top, right, bottom = _runs_ink(runs)
    if right is None:
        return 0.0
    origin_x = p.px(cx) - (left + right) / 2
    origin_y = p.px(cy) - (top + bottom) / 2
    cursor = origin_x
    for text, fnt, color in runs:
        if text:
            p.draw.text((cursor, origin_y), text, font=fnt, fill=color, anchor="la")
            cursor += _advance(fnt, text)
    return width / p.s


def _draw_runs_left(p: _Painter, x: float, baseline_y: float, runs):
    """左对齐（按推进宽度排），baseline_y 是基线。返回宽度（设计单位）。"""
    cursor = p.px(x)
    for text, fnt, color in runs:
        if text:
            p.draw.text((cursor, p.px(baseline_y)), text, font=fnt, fill=color, anchor="ls")
            cursor += _advance(fnt, text)
    return (cursor - p.px(x)) / p.s


def _draw_spaced(p: _Painter, x: float, baseline_y: float, text: str, fnt, color, spacing: float):
    """带字距的文本（对应 CSS letter-spacing）。spacing 为设计单位。"""
    cursor = p.px(x)
    step = p.px(spacing)
    for index, char in enumerate(text):
        p.draw.text((cursor, p.px(baseline_y)), char, font=fnt, fill=color, anchor="ls")
        cursor += _advance(fnt, char) + (step if index < len(text) - 1 else 0)
    return (cursor - p.px(x)) / p.s


def _spaced_width(p: _Painter, text: str, fnt, spacing: float) -> float:
    if not text:
        return 0.0
    total = sum(_advance(fnt, char) for char in text) + p.px(spacing) * (len(text) - 1)
    return total / p.s


def _num_font(p: _Painter, text, size: float, key: str = "digit"):
    """数字/西文用数字字体，出现占位符「—」时改用中文字体。

    ⚠️ Azonix 与 Industry 都没有破折号字形，直接画会变成豆腐块。
    缺数据时的「—」在卡片上很常见（没导出的字段），所以这里统一兜住。
    """
    return p.font("cn_black" if "—" in str(text) else key, size)


# ── 各模块 ───────────────────────────────────────────────────────────

def _draw_favorite(p: _Painter, data: dict) -> None:
    """``.np-favorite``：左上角收藏品/珍藏品 + 星级胶囊。

    BOT 专属：整块按 ``_FAVORITE_SCALE`` 放大（网页端为 1×）。锚点仍是左上角
    的 (22, 20)，只放大尺寸、不动位置。
    """
    k = _FAVORITE_SCALE
    item = data["favoriteItem"]
    block_x, block_y, block_w = 22.0, 20.0, 88.0 * k
    mascot_w, mascot_h = 72.0 * k, 64.0 * k
    mascot_x = block_x + (block_w - mascot_w) / 2
    mascot_y = block_y
    clip = p.box(mascot_x, mascot_y, mascot_w, mascot_h)

    layer = Image.new("RGBA", p.canvas.size, (0, 0, 0, 0))
    sub = _Painter(p.s, p.w, p.h)
    sub.canvas = layer
    sub.draw = ImageDraw.Draw(layer)
    source = _load(item.get("asset"))
    if source is not None:
        if item.get("isFavorite"):
            # has-icon 分支：object-fit:contain + object-position:50% 100%（贴底居中）
            sub.image(source, mascot_x, mascot_y, mascot_w, mascot_h, align="bottom-center")
        else:
            sub.image(source, mascot_x - 2 * k, mascot_y - 4 * k, 76 * k, 82 * k, align="top-center")
    ghost = imaging.drop_shadow(layer, (0, 2 * p.s), 1 * p.s, (34, 29, 40), 0.18)
    p.canvas.alpha_composite(ghost)
    imaging.clip_paste(p.canvas, layer, (0, 0), clip)

    rarity = str(item.get("rarity") or "").lower()
    color = _STAR_BLUE if rarity == "r" else _STAR_ORANGE if rarity == "ssr" else _STAR_PURPLE
    pill_w, pill_h = 64.0 * k, 19.0 * k
    pill_y = block_y + mascot_h
    p.panel(block_x + (block_w - pill_w) / 2, pill_y, pill_w, pill_h, radius=pill_h / 2, fill=color)
    stars = item.get("stars")
    centre_x = block_x + block_w / 2
    centre_y = pill_y + pill_h / 2 + 0.5 * k
    for index in range(3):
        cx = centre_x + (index - 1) * 16 * k
        filled = stars is not None and index < stars
        fill = (255, 255, 255, 255) if filled else (255, 255, 255, 69)
        p.draw.polygon(
            [(p.px(x), p.px(y)) for x, y in imaging.star_polygon(cx, centre_y, 5.0 * k)],
            fill=fill,
        )


def _draw_level_badge(p: _Painter, cx: float, cy: float, size: float, value, font_size: float) -> None:
    """``.np-level-badge``：等级角标（装饰帧 + 数字）。"""
    x = cx - size / 2
    y = cy - size / 2
    p.decoration("level-badge", x, y, size, size, shadow=(0, 2, 2, (21, 26, 31), 0.34))
    text = "—" if value is None else str(value)
    _draw_runs_center(p, cx, cy, [(text, _num_font(p, text, font_size, "num"), (255, 255, 255, 255))])


def _draw_cube(p: _Painter, data: dict, below_favorite: bool) -> None:
    """``.np-cube``：魔方图标 + 等级角标。

    BOT 专属：整体按 ``_CUBE_SCALE`` 放大（网页端为 1×），让魔方的视觉尺寸
    跟左上角放大后的收藏品大致对齐。
    """
    k = _CUBE_SCALE
    cube = data["cube"]
    x = 22.0
    # 有收藏品时下移到其下方（对应网页端 `.np-card.has-favorite .np-cube{top:112px}`）：
    # 20(顶) + 收藏品块高 83 + 间距 8，块高与间距按收藏品的倍数一并折算
    y = 20.0 + (64.0 + 19.0 + 8.0) * _FAVORITE_SCALE if below_favorite else 20.0
    art = 60.0 * k  # 对应 .np-cube-art 的 60×60，在 64×64 的 .np-cube 里居中（偏 2）
    p.image(_load(cube.get("asset")), x + 2 * k, y + 2 * k, art, art,
            shadow=(0, 2, 2, (24, 31, 39), 0.24))
    _draw_level_badge(p, x + (64.0 + 3.0 - 12.0) * k, y + (64.0 + 3.0 - 12.0) * k,
                      24.0 * k, cube.get("level"), 13.0 * k)


def _draw_skills(p: _Painter, data: dict) -> None:
    """``.np-skills``：左下角竖排（技能1 → 技能2 → 爆裂）。

    BOT 专属：整组按 ``_SKILL_SCALE`` 等比放大（网页端为 1×）。图标框、图标本体、
    等级角标、角标偏移与行间距全部跟着缩放，底边仍锚在 ``CARD_HEIGHT - 22``。
    """
    k = _SKILL_SCALE
    skills = data["skills"]
    standard = [s for s in skills if s["key"] != "burst"]
    burst = next((s for s in skills if s["key"] == "burst"), None)

    std_size, burst_size, gap = 46.0 * k, 76.0 * k, 8.0 * k
    standard_height = len(standard) * std_size + max(0, len(standard) - 1) * gap
    total_height = standard_height + (gap + burst_size if burst else 0)
    y = CARD_HEIGHT - 22 - total_height

    def one(skill, size, font_size):
        nonlocal y
        p.decoration("skill-frame", 22, y, size, size, shadow=(0, 2 * k, 2 * k, (24, 29, 34), 0.28))
        glyph = (56.0 if size >= burst_size else 34.0) * k
        p.image(_load(skill["url"]), 22 + (size - glyph) / 2, y + (size - glyph) / 2, glyph, glyph)
        _draw_level_badge(p, 22 + size + 4 * k - font_size, y + size + 4 * k - font_size,
                          font_size * 1.6, skill["level"], font_size)
        y += size + gap

    for skill in standard:
        one(skill, std_size, 12.0 * k)
    if burst:
        one(burst, burst_size, 13.0 * k)


# ── 右侧身份信息区 ────────────────────────────────────────────────────

_IDENTITY_TOP = 24.0
_IDENTITY_RIGHT = 20.0
_IDENTITY_WIDTH = 360.0
_IDENTITY_GAP = 7.0


def _draw_meta_item(p: _Painter, x: float, y: float, group: str, value, kind: str, level) -> None:
    """``.np-meta``：50×58 的元数据格（native 直接贴图，glyph 画六边形底 + 黑色剪影）。"""
    cx = x + 25
    cy = y + 29
    is_native = kind.startswith("native")
    source = _load(gamedata.meta_asset(group, value))
    if is_native:
        if source is not None:
            p.image(source, cx - 57.5 / 2, cy - 63.773 / 2, 57.5, 63.773)
    else:
        is_weapon = "weapon" in kind
        inner = (42.0, 49.0) if is_weapon else (44.0, 51.0)
        outer_mask = imaging.hexagon_mask(p.size(46, 53))
        inner_mask = imaging.hexagon_mask(p.size(*inner))
        outer_color = (53, 57, 61, 255) if is_weapon else (207, 211, 215, 255)
        imaging.paste_mask(p.canvas, outer_color, outer_mask, (p.px(cx - 23), p.px(cy - 26.5)))
        imaging.paste_mask(p.canvas, (255, 255, 255, 255), inner_mask,
                           (p.px(cx - inner[0] / 2), p.px(cy - inner[1] / 2)))
        if source is not None:
            icon_size = 23.0 if is_weapon else (22.0 if group == "class" else 20.0)
            shift = 0.0 if is_weapon else -7.0
            p.image(source, cx - icon_size / 2, cy - icon_size / 2 + shift, icon_size, icon_size, silhouette=True)
    has_level = group in ("class", "manufacturer")
    if has_level:
        baseline = y + 58 - 9 - 1
        level_text = "—" if level is None else str(level)
        runs = [
            ("LV.", p.font("num", 9), (52, 56, 60, 255)),
            (level_text, _num_font(p, level_text, 10.5, "num"), (52, 56, 60, 255)),
        ]
        _draw_runs_center(p, cx, baseline, runs)


def _draw_identity(p: _Painter, data: dict, modules: dict) -> None:
    """``.np-identity``：稀有度/突破 → 等级名称 → 好感度 → 战斗力 → 属性图标组。"""
    if not any(modules.get(key) for key in ("rarity", "levelName", "affection", "combat", "metadata")):
        return
    right = CARD_WIDTH - _IDENTITY_RIGHT
    y = _IDENTITY_TOP

    # 稀有度 / 突破
    if modules.get("rarity"):
        row_x = right - 248
        row_bottom = y + 42
        rarity = _load(data.get("rarityAsset"))
        if rarity is not None:
            p.image(rarity, row_x + 8, row_bottom - 30, 92, 30, fit="contain", align="bottom-left", shadow=(0, 2, 1, (126, 72, 0), 0.16))
        grade = data["limitBreak"]["grade"]
        core_badge = data["limitBreak"]["coreBadge"]
        # .np-breakthrough 靠右（行有 padding-right 3px）；.np-core margin-left:-4px
        # → 核心框左移 4px 压住星星右边，星星整体右边缘 = 核心框左边 + 4
        core_left = right - 3 - 38
        star_left = core_left + 4 - (28 * 3 - 5 * 2)
        for index in range(3):
            p.image(_load(gamedata.star_asset(index < grade)),
                    star_left + index * (28 - 5), row_bottom - 38 + (38 - 28) / 2, 28, 28)
        if core_badge:
            _draw_core(p, core_left, row_bottom - 38, core_badge)
        y = row_bottom + _IDENTITY_GAP

    # 等级 / 名称
    if modules.get("levelName"):
        name = data["name"]
        name_size = 19.0 if len(name) >= 8 else 22.0
        level_text = "—" if data["level"] is None else str(data["level"])
        level_runs = [
            ("LV. ", p.font("num", 24), _LEVEL_TEXT),
            (level_text, _num_font(p, level_text, 32, "num"), _LEVEL_VALUE),
        ]
        level_width = _runs_width(level_runs) / p.s
        name_width = _advance(p.font("cn", name_size), name) / p.s
        width = min(_IDENTITY_WIDTH, max(248.0, level_width + 12 + name_width + 24))
        height = 50.0
        x = right - width
        p.panel(x, y, width, height, radius=8, fill=_LEVEL_NAME_BG, shadow=(0, 4, 5, (26, 30, 34), 0.24))
        _draw_runs_center(p, x + 12 + level_width / 2, y + height / 2, level_runs)
        _draw_runs_center(p, x + 12 + level_width + 12 + (width - 24 - level_width - 12) / 2, y + height / 2,
                          [(name, p.font("cn", name_size), (255, 255, 255, 255))])
        y += height + _IDENTITY_GAP

    # 好感度
    if modules.get("affection"):
        width, height = 174.0, 31.0
        x = right - 3 - width
        p.panel(x, y, width, height, radius=5, fill=(255, 255, 255, 199))
        p.decoration("affection-frame", x, y, width, height)
        affection = data["affection"]
        text = "—" if affection is None else str(affection)
        caption_runs = [
            ("»", p.font("num", 12), _AFFECTION_TEXT),
            ("attraction", p.font("num", 10), _AFFECTION_TEXT),
        ]
        rank_runs = [("RANK", p.font("num", 14), _AFFECTION_TEXT)]
        em_size = (30.0, 28.571)
        caption_w = sum(_advance(f, t) for t, f, _c in caption_runs) / p.s + 4 + 0.075 * 12
        rank_w = _advance(p.font("num", 14), "RANK") / p.s
        total = caption_w + 7 + rank_w + 7 + em_size[0]
        cursor = x + 9 + (width - 15 - total) / 2
        cursor += _draw_runs_left(p, cursor, y + height / 2 + 3.5, caption_runs) + 4
        _draw_runs_left(p, cursor, y + height / 2 + 3.5, rank_runs)
        em_x = x + 9 + (width - 15 - total) / 2 + total - em_size[0]
        em_y = y + (height - em_size[1]) / 2
        p.decoration("heart", em_x, em_y, em_size[0], em_size[1])
        _draw_runs_center(p, em_x + em_size[0] / 2, em_y + em_size[1] / 2 - 3,
                          [(text, _num_font(p, text, 11 if len(text) > 2 else 14, "num"), (255, 255, 255, 255))])
        y += height + _IDENTITY_GAP

    # 战斗力
    if modules.get("combat"):
        label_font = p.font("cn", 13)
        value_text = "—" if data["combat"] is None else str(data["combat"])
        value_font = _num_font(p, value_text, 41, "num")
        battle_font = p.font("num", 11)
        label_w = _advance(label_font, "战斗力") / p.s + 2
        value_w = _advance(value_font, value_text) / p.s
        battle_w = _spaced_width(p, "BATTLE", battle_font, 11 * 0.24)
        width = max(label_w, value_w, battle_w) + 14
        height = 5 + 13 + 2 + 41 + 2 + 11 + 6
        x = right - width
        p.panel(x, y, width, height, radius=2, fill=(255, 255, 255, 232), shadow=(0, 2, 3, (28, 33, 39), 0.11))
        _draw_runs_left(p, x + 7 + 2, y + 5 + 11, [(("战斗力"), label_font, (52, 55, 58, 255))])
        _draw_runs_left(p, x + 7, y + 5 + 13 + 2 + 38, [(value_text, value_font, (52, 55, 58, 255))])
        _draw_spaced(p, x + (width - battle_w) / 2, y + 5 + 13 + 2 + 41 + 2 + 10, "BATTLE",
                     battle_font, (52, 56, 60, 255), 11 * 0.24)
        y += height + _IDENTITY_GAP

    # 属性图标组
    if modules.get("metadata"):
        rows = [
            [("burst", data["burstStage"], "native", None),
             ("element", data["element"], "native element", None),
             ("weapon", data["weaponType"], "glyph weapon", None)],
            [("class", data["className"], "glyph class", data["classLevel"]),
             ("manufacturer", data["corporation"], "glyph manufacturer", data["corporationLevel"])],
        ]
        for row in rows:
            row_width = len(row) * 50 + (len(row) - 1) * 5
            row_x = right - row_width
            for index, (group, value, kind, level) in enumerate(row):
                _draw_meta_item(p, row_x + index * 55, y, group, value, kind, level)
            y += 58 + 5


def _draw_core(p: _Painter, x: float, y: float, badge: str) -> None:
    """``.np-core``：核心突破角标（框架图 + 数字/MAX）。"""
    p.image(_load(gamedata.CORE_FRAME_ASSET), x, y, 38, 38, shadow=(0, 2, 2, (56, 20, 62), 0.25))
    size = 11.0 if badge == "MAX" else 16.0
    _draw_runs_center(p, x + 19, y + 19, [(badge, _num_font(p, badge, size, "num"), (255, 255, 255, 255))])


# ── 装备与词条合计 ────────────────────────────────────────────────────

_PANEL_WIDTH = 316.0
_PANEL_MARGIN = 10.0


def _tier_runs(p: _Painter, tier, suffix: str = "档】"):
    """``.np-affix-values`` 里的【N档】。

    ⚠️ 方括号与「档」必须用中文字体：Azonix 只有拉丁字形，
    用它会画出豆腐块（这正是网页端只给 ``.np-num`` 换字体的原因）。
    """
    text = "—" if tier is None else str(int(tier))
    return [
        ("【", p.font("cn_black", 11), None),
        (text, _num_font(p, text, 11), None),
        (suffix, p.font("cn_black", 11), None),
    ]


def _draw_tier_and_value(p: _Painter, cell_x: float, cell_right: float, baseline_y: float,
                         tier, value_text: str, color, value_font_size: float = 13.5) -> None:
    """按 ``grid-template-columns: max-content 1fr`` 排：档位块贴左、数值右对齐。"""
    runs = [(text, fnt, color) for text, fnt, _ in _tier_runs(p, tier)]
    _draw_runs_left(p, cell_x, baseline_y, runs)
    value_font = _num_font(p, value_text, value_font_size)
    value_w = _advance(value_font, value_text) / p.s
    _draw_runs_left(p, cell_right - value_w, baseline_y + 0.5, [(value_text, value_font, color)])


def _draw_affix_summary(p: _Painter, data: dict, x: float, y: float) -> float:
    """``.np-affix-summary``：档位合计最高的三条词条。返回占用高度（含 12px 下边距）。"""
    items = data["topAffixes"]
    rows = len(items)
    inner_w = 240.0
    row_h = 18.0
    height = 4 + rows * row_h + max(0, rows - 1) * 2 + 4
    p.panel(x, y, 248, height, radius=5, fill=_PANEL_BG, shadow=(0, 2, 4, (27, 33, 40), 0.15))
    name_font = p.font("cn_black", 11.5)
    value_font = p.font("digit", 13)
    for index, item in enumerate(items):
        row_y = y + 4 + index * (row_h + 2)
        p.panel(x + 4, row_y, inner_w, row_h, radius=3, fill=_AFFIX_LINE_BG)
        # .np-affix-name 没有 text-align → 左对齐（居中会挤掉「优越代码伤害增加」右边的余量）
        _draw_runs_left(p, x + 4 + 4, row_y + row_h / 2 + 4, [(item["label"], name_font, _AFFIX_TEXT)])
        value_text = "—" if item["totalValue"] is None else f"{item['totalValue']:.2f}%"
        _draw_tier_and_value(p, x + 4 + 4 + 104 + 2, x + 4 + inner_w - 4, row_y + row_h / 2 + 4,
                             item["totalLevel"], value_text, _AFFIX_TEXT, 13)
    return height + 12


def _draw_equipment_grid(p: _Painter, data: dict, x: float, y: float) -> float:
    """``.np-equipment-grid``：4 件装备，每件 3 条词条。"""
    name_font = p.font("cn_black", 11.8)
    gap = 7.0
    row_h = 76.0
    for slot in range(4):
        row_y = y + slot * (row_h + gap)
        p.panel(x, row_y, 316, row_h, radius=5, fill=_EQUIPMENT_BG, shadow=(0, 2, 4, (25, 31, 38), 0.12))
        # 图标 align-self:center：行内容高 70，图标 64 → 上边距 3 + (70-64)/2 = 6
        _draw_equipment_icon(p, data, slot, x + 5, row_y + 3 + (row_h - 6 - 64) / 2)
        lines_x = x + 5 + 64 + 8
        lines_h = row_h - 6
        line_h = (lines_h - 2 * 2) / 3
        for index in range(3):
            line = data["equipments"][slot][index]
            line_y = row_y + 3 + index * (line_h + 2)
            tier = line["level"] if line else None
            # 对应网页端两条互斥规则，注意变色的**范围不同**：
            #   .np-affix-line.tier-15{background:#242424; color:#08ace6}
            #       → 整行继承蓝色，含词条名，底色转深
            #   .np-affix-line.tier-blue .np-affix-values{color:#009de0}
            #       → 只有「档位 + 数值」那一列变蓝，**词条名仍保持深色**
            if line and tier == 15:
                bg, name_color, value_color = _AFFIX_LINE_15_BG, _TIER15_TEXT, _TIER15_TEXT
            elif line and tier is not None and tier >= 12:
                bg, name_color, value_color = _AFFIX_LINE_BG, _AFFIX_TEXT, _TIER_BLUE
            else:
                bg, name_color, value_color = _AFFIX_LINE_BG, _AFFIX_TEXT, _AFFIX_TEXT
            p.panel(lines_x, line_y, 236, line_h, radius=3, fill=bg)
            baseline = line_y + line_h / 2 + 4
            if not line:
                _draw_runs_left(p, lines_x + 4, line_y + line_h / 2 + 4, [("—", name_font, name_color)])
                _draw_runs_center(p, lines_x + 236 - 4 - 30, line_y + line_h / 2,
                                  [("—", p.font("cn_black", 13.5), value_color)])
                continue
            _draw_runs_left(p, lines_x + 4, line_y + line_h / 2 + 4, [(line["label"], name_font, name_color)])
            _draw_tier_and_value(p, lines_x + 4 + 104 + 2, lines_x + 236 - 4, baseline,
                                 tier, cardmodel.format_percent(line.get("value")), value_color)
    return 4 * row_h + 3 * gap


def _draw_equipment_icon(p: _Painter, data: dict, slot: int, x: float, y: float) -> None:
    """``.np-equipment-icon``：粉色描边装备格 + 图标 + 过载/职业角标。"""
    display = data["equipmentDisplays"][slot]
    p.panel(x, y, 64, 64, radius=6, fill=(245, 247, 248, 209), shadow=(0, 3, 3, (18, 20, 24), 0.44))
    p.draw.rounded_rectangle(p.box(x, y, 64, 64), radius=p.px(6), outline=(233, 129, 157, 255), width=max(1, round(p.s)))
    p.draw.rounded_rectangle(p.box(x + 1, y + 1, 62, 62), radius=p.px(4), outline=(255, 181, 201, 117), width=max(1, round(p.s)))
    p.image(_load(display["icon"]), x + 1, y + 1, 62, 62)
    # 角标：过载徽章 + 职业徽章（manufacturer 在装备展示里恒为空）
    badge_x, badge_y = x - 6, y - 6
    badge = _load(gamedata.OVERLOAD_BADGE_ASSET)
    if badge is not None:
        p.image(badge, badge_x - (24 - 19) / 2, badge_y - (26.571 - 22) / 2, 24, 26.571)
    class_icon = _load(gamedata.meta_asset("class", display["className"]))
    if class_icon is not None:
        class_y = badge_y + 22 - 2.4
        outer = imaging.hexagon_mask(p.size(19, 22))
        inner = imaging.hexagon_mask(p.size(19 - 1.6, 22 - 1.6))
        imaging.paste_mask(p.canvas, (21, 23, 25, 255), outer, (p.px(badge_x), p.px(class_y)))
        imaging.paste_mask(p.canvas, (233, 237, 239, 255), inner, (p.px(badge_x + 0.8), p.px(class_y + 0.8)))
        imaging.paste_mask(p.canvas, (48, 51, 54, 255), imaging.hexagon_mask(p.size(19 - 3.2, 22 - 3.2)),
                           (p.px(badge_x + 1.6), p.px(class_y + 1.6)))
        # 注意：这里**不能**转剪影。职业素材本身是白色，网页端 `.np-class-badge img`
        # 也没有 `filter: brightness(0)`；内芯已经是深色 (48,51,54)，再染黑就黑底黑图
        # 完全看不见了。（`_draw_meta_item` 那边内芯是白的，才需要 silhouette。）
        p.image(class_icon, badge_x + (19 - 10.3) / 2, class_y + (22 - 13.5) / 2, 10.3, 13.5)


def _draw_equipment_panel(p: _Painter, data: dict, modules: dict, panel_scale: float) -> None:
    """面板整体：词条合计 + 四件装备，按 panelScale 缩放后贴到右下角。

    缩放不再靠「画完再 resize」——那样会糊。这里直接把内层画笔的 scale 乘上
    panelScale，等于矢量缩放，文字边缘一样锐利。
    """
    margin = _PANEL_MARGIN
    inner = _Painter(p.s * (panel_scale / 100), _PANEL_WIDTH + margin * 2, 640)
    y = margin
    if modules.get("affixSummary") and data["topAffixes"]:
        y += _draw_affix_summary(inner, data, _PANEL_WIDTH + margin - 248, y)
    if modules.get("equipments"):
        y += _draw_equipment_grid(inner, data, margin, y)

    anchor_x = p.px(CARD_WIDTH - 22)
    anchor_y = p.px(CARD_HEIGHT - 22)
    # 对应网页端的 `.np-equipment-panel{inset:auto 22px 22px auto}` 配
    # `transform-origin: right bottom`：右下角钉死在 (卡宽-22, 卡高-22)，缩放不动它。
    # ⚠️ 减掉的必须是**内容**的右下角坐标：内容是 inner 里
    # x ∈ [margin, margin+316]、y ∈ [margin, y] 的那一块，
    # 所以横向减 `_PANEL_WIDTH + margin`、纵向减 `y`。
    # 纵向若多减一个 margin，整块会往下挪 10×缩放，滑块越大越贴底边。
    p.canvas.alpha_composite(
        inner.canvas,
        (anchor_x - inner.px(_PANEL_WIDTH + margin), anchor_y - inner.px(y)),
    )


# ── 入口 ─────────────────────────────────────────────────────────────

def render_card(
    character: dict,
    record: dict | None,
    *,
    scale: float = 2,
    transparent: bool = False,
    synchro_level=None,
    research=None,
    modules: dict | None = None,
    panel_scale: float = DEFAULT_PANEL_SCALE,
    artwork_id: str | None = None,
    art_scale: float = 100,
    art_offset_x: float = 50,
    art_offset_y: float = 0,
) -> Image.Image:
    """画一张角色卡。

    modules 缺省＝全部打开（对应网页端的 DEFAULT_MODULES）。
    artwork_id 缺省立绘的 id；art_scale/art_offset_* 对应右栏的「立绘微调」。
    """
    modules = modules or cardlayout.default_modules()
    data = cardmodel.build_card_data(character, record, synchro_level=synchro_level, research=research)
    p = _Painter(scale, CARD_WIDTH, CARD_HEIGHT)
    for value in (data["name"], data["favoriteItem"]["rarity"] if data["favoriteItem"] else ""):
        imaging.check_coverage(value)

    if not transparent:
        p.canvas.paste(imaging.v_gradient((p.px(CARD_WIDTH), p.px(CARD_HEIGHT)), _BG_STOPS), (0, 0))

    # 立绘（.np-card-art：cover + 以中心为原点的 scale，再整体位移）
    artwork = cardmodel.resolve_artwork(character, artwork_id)
    if artwork:
        source = _load(f"{_ARTWORK_ROOT}/{artwork['file']}")
        if source is not None:
            factor = art_scale / 100
            covered = imaging.cover(imaging.fit_filters(source, 0.96, 1.01),
                                    p.px(CARD_WIDTH), p.px(CARD_HEIGHT))
            scaled = covered.resize(
                (max(1, round(covered.width * factor)), max(1, round(covered.height * factor))),
                Image.LANCZOS,
            )
            centre_x, centre_y = p.px(CARD_WIDTH) / 2, p.px(CARD_HEIGHT) / 2
            base_x = (p.px(CARD_WIDTH) - covered.width) / 2
            base_y = (p.px(CARD_HEIGHT) - covered.height) / 2
            dx = ((art_offset_x - 50) * factor) / 100 * p.px(CARD_WIDTH)
            dy = (art_offset_y * factor) / 100 * p.px(CARD_HEIGHT)
            left = centre_x + (base_x - centre_x) * factor + dx
            top = centre_y + (base_y - centre_y) * factor + dy
            ghost = imaging.drop_shadow(scaled, (0, 9 * p.s), 7 * p.s, (36, 40, 48), 0.16)
            p.canvas.alpha_composite(ghost, (round(left), round(top)))
            p.canvas.alpha_composite(scaled, (round(left), round(top)))

    has_favorite = bool(modules.get("favoriteItem") and data["favoriteItem"])
    if has_favorite:
        _draw_favorite(p, data)
    if modules.get("skills") and data["skills"]:
        _draw_skills(p, data)
    if modules.get("cube") and data["cube"]:
        _draw_cube(p, data, has_favorite)
    _draw_identity(p, data, modules)
    if modules.get("affixSummary") or modules.get("equipments"):
        _draw_equipment_panel(p, data, modules, panel_scale)
    return p.canvas
