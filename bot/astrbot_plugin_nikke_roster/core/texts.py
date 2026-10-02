"""面向用户的文案。所有对外文字都放这里，改文案不用翻业务代码。"""
from __future__ import annotations

BOT_NAME = "NIKKE练度统计助手"

INTRO = (
    "NIKKE 练度统计助手：把网页端导出的分享码导入 BOT，练度数据按 QQ 各自保存，"
    "之后可以直接在聊天里出角色面板图和练度统计表。"
)

USAGE_NOTE = [
    "· 私聊直接发命令即可；群聊里要在前面加「/」，例如 /妮姬帮助。",
    "· 命令是整串匹配的，命令名和参数之间用空格分隔。",
    "· 每个人的练度数据各自独立，互相看不到。",
    "· 装备词条只能在网页端录入，BOT 这边负责导入、出图和改数值。",
]

# 「已实现」区：只列**真能跑通**的命令。新命令接入后往这里加，
# 不做「占位按钮」—— 用户照着帮助敲却报「未知命令」是最差的体验。
COMMAND_GROUPS = [
    ("基础", [
        ("/妮姬帮助", "显示这份帮助"),
        ("/妮姬网址", "要网页端地址，去那里录入练度并导出分享码"),
        ("/妮姬自检", "检查角色表、素材、字体、数据目录是否就绪"),
    ]),
    ("数据", [
        ("/妮姬导入 <分享码>", "导入分享码（角色数据和表格配置都认）"),
        ("/妮姬列表", "看自己已导入的角色和练度"),
    ]),
    ("出图", [
        ("/妮姬面板 <角色>", "出该角色的练度面板图"),
        ("/妮姬练度统计", "出一张练度统计表"),
        ("/妮姬练度统计设置 <角色> <角色> ...", "定表格里有谁、按什么顺序排"),
    ]),
    ("改数值", [
        ("/妮姬同步器 <等级>", "设同步器等级（1~2000，全体共用）"),
        ("/妮姬好感 <角色> <值>", "改好感度（0~40）"),
        ("/妮姬星级 <角色> <值>", "改突破星级（0~3）"),
        ("/妮姬核心 <角色> <值>", "改核心突破（0~7）"),
        ("/妮姬技能1 <角色> <值>", "改技能 1（1~10）"),
        ("/妮姬技能2 <角色> <值>", "改技能 2（1~10）"),
        ("/妮姬爆裂 <角色> <值>", "改爆裂技能（1~10）"),
    ]),
    ("一键：改自己已导入的全部角色", [
        ("/妮姬一键好感度 <值>", "好感度"),
        ("/妮姬一键星级 <值>", "突破星级"),
        ("/妮姬一键核心 <值>", "核心突破"),
        ("/妮姬一键技能1 <值>", "技能 1"),
        ("/妮姬一键技能2 <值>", "技能 2"),
        ("/妮姬一键爆裂 <值>", "爆裂技能"),
    ]),
]

FOOTER = ""


def _all_commands() -> list[tuple[str, str]]:
    return [item for _title, items in COMMAND_GROUPS for item in items]


def web_url_note(web_url: str) -> str:
    return f"网页端：{web_url}" if web_url else "网页端：尚未在插件配置里填写地址"


def _header(web_url: str) -> list[str]:
    lines = [f"【{BOT_NAME}】", "", INTRO, ""]
    lines += USAGE_NOTE
    lines += ["", web_url_note(web_url), ""]
    return lines


def _render_group(title: str, items: list[tuple[str, str]], width: int) -> list[str]:
    lines = [f"▍{title}"]
    lines += [f"  {name.ljust(width)}  {desc}" for name, desc in items]
    return lines


def help_text(web_url: str = "") -> str:
    width = max(len(name) for name, _ in _all_commands())
    lines = _header(web_url)
    for index, (title, items) in enumerate(COMMAND_GROUPS):
        if index:
            lines.append("")
        lines += _render_group(title, items, width)
    if FOOTER:
        lines += ["", FOOTER]
    return "\n".join(lines)


def help_nodes(web_url: str = "") -> list[tuple[str, str]]:
    """合并转发的分节：``[(节点标题, 节点正文), ...]``。

    和纯文本版共用同一份 COMMAND_GROUPS，避免两边文案漂移。
    """
    width = max(len(name) for name, _ in _all_commands())
    nodes = [(f"{BOT_NAME} · 总览", "\n".join(_header(web_url) + _render_group(*COMMAND_GROUPS[0], width)))]
    nodes += [
        (f"{BOT_NAME} · {title}", "\n".join(_render_group(title, items, width)))
        for title, items in COMMAND_GROUPS[1:]
    ]
    return nodes


# ── 错误与提示 ───────────────────────────────────────────────────────

NO_RECORD_HINT = "先在网页端录入并导出分享码，然后发 /妮姬导入 <分享码>"


def unknown_character(query: str) -> str:
    return f"没找到叫「{query}」的角色。可以用 /妮姬列表 看自己已导入的人，或者换个叫法试试。"


def ambiguous_character(query: str, names: list[str]) -> str:
    return f"「{query}」能对上好几个角色：{'、'.join(names)}\n请把名字写全一点。"


def not_imported(name: str) -> str:
    return f"{name} 还没导入过数据。{NO_RECORD_HINT}"


def bad_value(label: str, low: int, high: int) -> str:
    return f"{label}要填 {low}~{high} 之间的整数。"


def bad_args(command: str, usage: str) -> str:
    return f"用法：{command} {usage}"


def render_failed(exc: Exception) -> str:
    return f"出图失败：{type(exc).__name__}: {exc}"


# ── /妮姬列表 ────────────────────────────────────────────────────────

def list_text(synchro_level: int, rows: list[dict], chunk: int = 12) -> str:
    """rows: ``[{"name", "element", "tierScore", "complete"}, ...]``（顺序即展示顺序）。

    完善（四件装备都录了词条）的排在前面，因为只有他们能进练度统计表。
    """
    if not rows:
        return f"还没有导入任何角色数据。\n{NO_RECORD_HINT}"
    done = [row for row in rows if row["complete"]]
    todo = [row for row in rows if not row["complete"]]

    lines = [f"同步器 LV.{synchro_level} · 已导入 {len(rows)} 个角色（装备已录入 {len(done)}）"]
    if done:
        lines += ["", f"▍可进练度统计（{len(done)}）"]
        for row in done:
            element = f" · {row['element']}" if row["element"] else ""
            lines.append(f"  {row['name']}{element} · 阶数 {row['tierScore']}")
    if todo:
        lines += ["", f"▍装备还没录（{len(todo)}）"]
        for row in todo:
            element = f" · {row['element']}" if row["element"] else ""
            lines.append(f"  {row['name']}{element}")
    return "\n".join(lines)


# ── 导入回执 ─────────────────────────────────────────────────────────

def import_receipt(kind: str, added: int, updated: int, synchro_level: int | None,
                   names: list[str], unknown: list[str], table_rows: int = 0) -> str:
    if kind == "table":
        lines = [f"收到表格配置：{table_rows} 行。", "之后发 /妮姬练度统计 就按这个名单和顺序出表。"]
        missing = unknown
        if missing:
            shown = "、".join(missing[:8])
            more = f" 等 {len(missing)} 个" if len(missing) > 8 else ""
            lines.append(f"其中 {shown}{more} 你还没导入，出表时会跳过。")
        return "\n".join(lines)

    lines = [f"导入完成：新增 {added} 个，更新 {updated} 个。"]
    if names:
        shown = "、".join(names[:10])
        more = f" 等 {len(names)} 个" if len(names) > 10 else ""
        lines.append(f"本次涉及：{shown}{more}")
    if synchro_level is not None:
        lines.append(f"同步器等级已按分享码设为 LV.{synchro_level}。")
    lines.append("发 /妮姬面板 <角色> 看卡片，/妮姬列表 看全部。")
    return "\n".join(lines)


def changed_receipt(label: str, value, count: int | None = None, name: str = "") -> str:
    if count is None:
        return f"已把 {name} 的{label}改成 {value}。"
    if count == 0:
        return f"你还没导入任何角色，没有可改的数据。\n{NO_RECORD_HINT}"
    return f"已把 {count} 个已导入角色的{label}改成 {value}。"


def synchro_receipt(old, new) -> str:
    return f"同步器等级：LV.{old} → LV.{new}（全体妮姬共用，出图立刻生效）"


def table_config_receipt(rows: int, skipped: list[str], missing: list[str]) -> str:
    lines = [f"表格配置好了：{rows} 行。发 /妮姬练度统计 出表。"]
    if missing:
        shown = "、".join(missing[:8])
        lines.append(f"没找到：{shown}")
    if skipped:
        shown = "、".join(skipped[:8])
        more = f" 等 {len(skipped)} 个" if len(skipped) > 8 else ""
        lines.append(f"装备还没录完，出表时会跳过：{shown}{more}")
    return "\n".join(lines)
