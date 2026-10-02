"""练度统计表渲染：按网页端 ``app/src/pages/StatsPage.jsx`` + ``styles/stats.css`` 手绘。

版式要点（照抄 CSS）：
  · 表头浅灰底 ``#f1f3f5``、字色 ``#5b636e``、居中
  · 单元格 1px ``#e3e6ea`` 细边框、内边距 6×12、不换行
  · 词条列与「阶数」用 Azonix；表头与角色名用中文字体（网页端是 SC_common_extra_bold）
  · 角色名用其属性的颜色（燃烧红 / 水冷蓝 / 风压绿 / 电击品红 / 铁甲橙）
  · 档位和 ≥ 40 蓝字 ``#009de0``；≥ 52 黑底 ``#242424`` 蓝字 ``#08ace6``
"""
from __future__ import annotations

from . import cardmodel, gamedata, imaging

#: 统计列（顺序与网页端 STATS_COLUMNS 一致；key 是词条类型）
STATS_COLUMNS = [
    ("IncElementDmg", "优越"),
    ("StatAtk", "攻击"),
    ("StatAmmoLoad", "装弹"),
    ("StatCriticalDamage", "暴伤"),
    ("StatCritical", "暴率"),
    ("StatChargeTime", "蓄速"),
    ("StatChargeDamage", "蓄伤"),
    ("StatAccuracyCircle", "命中"),
    ("StatDef", "防御"),
]

#: 属性 → (显示名, 名字颜色)，色系取自 public/icons/属性 图标
ELEMENTS = [
    (("Fire",), "燃烧", "#DE3B27"),
    (("Water",), "水冷", "#2F7DE1"),
    (("Wind",), "风压", "#35B34C"),
    (("Electronic", "Elect"), "电击", "#C13BC1"),
    (("Iron",), "铁甲", "#CE8327"),
]
_ELEMENT_INDEX = {key: (label, color) for keys, label, color in ELEMENTS for key in keys}
_ELEMENT_RANK = {label: index for index, (_keys, label, _color) in enumerate(ELEMENTS)}

# 表格样式常量（对应 stats.css）
_BORDER = (227, 230, 234, 255)      # #e3e6ea 单元格边框
_SHEET_BORDER = (227, 229, 232, 255)  # #e3e5e8 外框
_HEADER_BG = (241, 243, 245, 255)   # #f1f3f5
_HEADER_TEXT = (91, 99, 110, 255)   # #5b636e
_CELL_TEXT = (38, 41, 46, 255)      # #26292e
_BLUE = (0, 157, 224, 255)          # #009de0
_MAX_BG = (36, 36, 36, 255)         # #242424
_MAX_TEXT = (8, 172, 230, 255)      # #08ace6
_SHEET_BG = (255, 255, 255, 255)

_PAD_X = 12.0
_PAD_Y = 6.0
_HEADER_H = 28.0
_ROW_H = 29.0
_CORNER_MIN_W = 168.0
_RADIUS = 7.0


def _hex_to_rgb(text: str) -> tuple[int, int, int, int]:
    text = text.lstrip("#")
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16), 255)


def element_label(raw) -> str:
    return (_ELEMENT_INDEX.get(str(raw or "").strip()) or ("", ""))[0]


def element_color(raw) -> tuple[int, int, int, int] | None:
    color = (_ELEMENT_INDEX.get(str(raw or "").strip()) or ("", ""))[1]
    return _hex_to_rgb(color) if color else None


def element_rank(raw) -> int:
    """属性排序位次：燃烧 → 水冷 → 风压 → 电击 → 铁甲；不认识的排最后。"""
    return _ELEMENT_RANK.get(element_label(raw), len(ELEMENTS))


def is_fully_recorded(record) -> bool:
    """可统计条件：四件装备都已录入（每件至少一条有效词条）。"""
    equipments = (record or {}).get("equipments")
    if not isinstance(equipments, (list, tuple)) or len(equipments) < 4:
        return False
    for slot in equipments[:4]:
        if not isinstance(slot, (list, tuple)):
            return False
        if not any(isinstance(line, dict) and line.get("functionType") for line in slot):
            return False
    return True


def build_character_stats(record) -> dict:
    """档案 → 统计。

    ``tierScore``（阶数）= 四件装备所有词条的档位直接相加（整数）。
    """
    by_function: dict[str, dict] = {}
    for slot in cardmodel.normalize_equipments((record or {}).get("equipments")):
        for line in slot:
            if not line or line["functionType"] not in gamedata.AFFIX_TIER_VALUES:
                continue
            acc = by_function.setdefault(line["functionType"], {"value": 0.0, "level": 0})
            acc["value"] += float(line.get("value") or 0)
            acc["level"] += int(line.get("level") or 0)
    return {
        "byFunction": by_function,
        "tierScore": sum(acc["level"] for acc in by_function.values()),
    }


def cell_tone(level: int) -> str:
    """档位和 → 色调：'' | 'is-blue'（≥40）| 'is-max'（≥52）。"""
    if level >= 52:
        return "is-max"
    return "is-blue" if level >= 40 else ""


def _measure(p: imaging.Painter, rows: list[dict]) -> list[float]:
    """量出各列宽度（设计单位）。"""
    header_font = p.font("cn_black", 13)
    name_font = p.font("cn_black", 13)
    cell_font = p.font("digit", 14)

    widths = [0.0] * (len(STATS_COLUMNS) + 2)
    for index, (_key, label) in enumerate(STATS_COLUMNS, start=1):
        widths[index] = (header_font.getlength(label) + _PAD_X * 2) / p.s
    widths[-1] = (header_font.getlength("阶数") + _PAD_X * 2) / p.s
    widths[0] = _CORNER_MIN_W

    for row in rows:
        widths[0] = max(widths[0], (name_font.getlength(row["name"]) + _PAD_X * 2) / p.s)
        for index, (key, _label) in enumerate(STATS_COLUMNS, start=1):
            cell = (row["stats"]["byFunction"] or {}).get(key)
            text = "" if not cell else f"{cell['value']:.2f}%"
            widths[index] = max(widths[index], (cell_font.getlength(text) + _PAD_X * 2) / p.s)
        tier_text = str(row["stats"]["tierScore"])
        widths[-1] = max(widths[-1], (cell_font.getlength(tier_text) + _PAD_X * 2) / p.s)
    return widths


def render_stats_table(rows: list[dict], *, scale: float = 2) -> "imaging.Image.Image":
    """rows: ``[{"name": 角色名, "element": 属性, "stats": build_character_stats(...)}, ...]``

    返回表格图片（含 1px 外框与圆角白底，与网页端导出的 ``.st-sheet`` 一致）。
    """
    if not rows:
        raise ValueError("表格里至少放一个角色")

    widths = _measure(imaging.Painter(scale, 10, 10), rows)  # 只用它量字
    table_w = sum(widths)
    table_h = _HEADER_H + _ROW_H * len(rows)
    p = imaging.Painter(scale, table_w + 2, table_h + 2)

    p.panel(0, 0, table_w + 2, table_h + 2, radius=_RADIUS, fill=_SHEET_BG, outline=_SHEET_BORDER)
    origin_x, origin_y = 1.0, 1.0

    header_font = p.font("cn_black", 13)
    name_font = p.font("cn_black", 13)
    cell_font = p.font("digit", 14)

    # 表头底色
    p.panel(origin_x, origin_y, table_w, _HEADER_H, fill=_HEADER_BG)
    # 「档位和 ≥ 52」的单元格黑底
    for index, row in enumerate(rows):
        row_y = origin_y + _HEADER_H + index * _ROW_H
        for col, (key, _label) in enumerate(STATS_COLUMNS, start=1):
            cell = (row["stats"]["byFunction"] or {}).get(key)
            if cell and cell_tone(cell["level"]) == "is-max":
                p.panel(origin_x + sum(widths[:col]), row_y, widths[col], _ROW_H, fill=_MAX_BG)

    # 文字
    for col, (_key, label) in enumerate(STATS_COLUMNS, start=1):
        _center(p, origin_x + sum(widths[:col]) + widths[col] / 2, origin_y + _HEADER_H / 2,
                label, header_font, _HEADER_TEXT)
    _center(p, origin_x + sum(widths[:-1]) + widths[-1] / 2, origin_y + _HEADER_H / 2,
            "阶数", header_font, _HEADER_TEXT)

    for index, row in enumerate(rows):
        row_cy = origin_y + _HEADER_H + index * _ROW_H + _ROW_H / 2
        _left(p, origin_x + _PAD_X, row_cy, row["name"], name_font,
              element_color(row.get("element")) or _CELL_TEXT)
        for col, (key, _label) in enumerate(STATS_COLUMNS, start=1):
            cell = (row["stats"]["byFunction"] or {}).get(key)
            if not cell:
                continue
            tone = cell_tone(cell["level"])
            color = _MAX_TEXT if tone == "is-max" else _BLUE if tone == "is-blue" else _CELL_TEXT
            _center(p, origin_x + sum(widths[:col]) + widths[col] / 2, row_cy,
                    f"{cell['value']:.2f}%", cell_font, color)
        _right(p, origin_x + sum(widths[:-1]) + widths[-1] - _PAD_X, row_cy,
               str(row["stats"]["tierScore"]), cell_font, _CELL_TEXT)

    # 网格线最后画：collapse 边框在网页端也是压在底色上的
    line_w = max(1, round(p.s))
    for col in range(len(widths) + 1):
        x = origin_x + sum(widths[:col])
        p.draw.line([(p.px(x), p.px(origin_y)), (p.px(x), p.px(origin_y + table_h))],
                    fill=_BORDER, width=line_w)
    for row in range(len(rows) + 2):
        y = origin_y + (_HEADER_H if row else 0) + max(0, row - 1) * _ROW_H
        p.draw.line([(p.px(origin_x), p.px(y)), (p.px(origin_x + table_w), p.px(y))],
                    fill=_BORDER, width=line_w)
    return p.canvas


def _center(p: imaging.Painter, cx: float, cy: float, text: str, fnt, color) -> None:
    left, top, right, bottom = fnt.getbbox(text)
    p.draw.text((p.px(cx) - (left + right) / 2, p.px(cy) - (top + bottom) / 2),
                text, font=fnt, fill=color)


def _left(p: imaging.Painter, x: float, cy: float, text: str, fnt, color) -> None:
    left, top, right, bottom = fnt.getbbox(text)
    p.draw.text((p.px(x) - left, p.px(cy) - (top + bottom) / 2), text, font=fnt, fill=color)


def _right(p: imaging.Painter, x: float, cy: float, text: str, fnt, color) -> None:
    left, top, right, bottom = fnt.getbbox(text)
    p.draw.text((p.px(x) - right, p.px(cy) - (top + bottom) / 2), text, font=fnt, fill=color)
