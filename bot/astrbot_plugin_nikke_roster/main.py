r"""NIKKE练度统计助手 —— AstrBot 插件入口。

分层
----
``main.py`` 只做「注册指令 → 取参数 → 调 core → 把结果发出去」，
业务规则一律在 ``core/`` 里，方便单独测：

* ``core/store.py``     按 QQ 的练度存档（加锁 + 原子写）
* ``core/sharecode.py`` NKP2 分享码解码
* ``core/card.py``      角色面板出图
* ``core/stats.py``     练度统计表出图
* ``core/roster.py``    角色表与名字解析

命令匹配
--------
AstrBot 的唤醒词是 ``/``：群聊里必须发 ``/妮姬帮助``，
私聊（``friend_message_needs_wake_prefix=false``）可以直接发 ``妮姬帮助``。
唤醒词在过滤器跑之前就被框架剥掉了，所以 ``event.get_message_str()``
拿到的是 ``妮姬帮助 ...``，参数自己切比声明 handler 形参更灵活
（角色名带空格、参数个数不定都好处理）。
"""
from __future__ import annotations

import asyncio
import re
import time
import uuid
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.message_components import Node, Nodes, Plain
from astrbot.api.star import Context, Star, register

_PLUGIN_DIR = Path(__file__).resolve().parent

# 兼容两种加载方式：优先相对导入；AstrBot 未按包加载时把插件目录挂上 sys.path
try:
    from .core import card
    from .core import paths
    from .core import roster as roster_mod
    from .core import sharecode, stats
    from .core import store as store_mod
    from .core import texts
except ImportError:  # pragma: no cover
    import sys

    if str(_PLUGIN_DIR) not in sys.path:
        sys.path.insert(0, str(_PLUGIN_DIR))
    from core import card
    from core import paths
    from core import roster as roster_mod
    from core import sharecode, stats
    from core import store as store_mod
    from core import texts

PLUGIN_NAME = paths.PLUGIN_NAME
VERSION = "0.2.0"
DESC = (
    "NIKKE 练度统计助手：导入网页端分享码，按 QQ 保存练度数据，"
    "出角色面板图与练度统计表。"
)

# 出图用的字体（由 bot/tools/build-fonts.mjs 生成，随插件分发，不依赖系统字体）
FONT_FILES = [
    "NotoSansSC-Regular.otf",   # 一般中文
    "NotoSansSC-Black.otf",     # 装备词条区中文（对应网页端的 SC_common_extra_bold）
    "Industry-Demi.ttf",        # 一般数字/西文（对应网页端的 Bahnschrift，同为 DIN 风格）
    "Azonix-Regular.otf",       # 词条区数字与 %（对应网页端 Deco_ext_azx）
]

_SPACE = re.compile(r"\s+")


def _args(event: AstrMessageEvent, command: str) -> list[str]:
    """取命令后面的参数（已按空白切好，命令名本身剥掉）。"""
    text = _SPACE.sub(" ", str(event.get_message_str() or "").strip())
    for prefix in (f"/{command}", command):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    return [part for part in text.split(" ") if part]


def _name_and_value(args: list[str]) -> tuple[str, str]:
    """前 n-1 段是角色名，最后一段是数值。

    角色名可能是英文名带空格的（``Snow White``），所以不能只取 ``args[0]``。
    """
    if len(args) < 2:
        return "", ""
    return " ".join(args[:-1]), args[-1]


@register(PLUGIN_NAME, "博哥", DESC, VERSION)
class NikkeRosterPlugin(Star):
    def __init__(self, context: Context, config=None):
        super().__init__(context)
        self.config = config or {}
        # 角色表：加载期不做重活，initialize 里再读
        self.roster: roster_mod.Roster | None = None
        self.load_error: str = ""

    # ── 生命周期 ─────────────────────────────────────────────────────
    async def initialize(self) -> None:
        try:
            self.roster = roster_mod.load()
        except Exception as exc:
            # 角色表缺失不该让插件加载失败：自检指令要能把这些话说清楚
            self.load_error = f"{type(exc).__name__}: {exc}"
            logger.error("[%s] 角色表加载失败：%s", PLUGIN_NAME, self.load_error)
        logger.info("[%s] v%s 已加载", PLUGIN_NAME, VERSION)

    # ── 配置 ─────────────────────────────────────────────────────────
    def _web_url(self) -> str:
        return str((self.config or {}).get("web_base_url") or "").strip()

    def _use_forward(self) -> bool:
        return bool((self.config or {}).get("help_use_forward", True))

    def _table(self) -> roster_mod.Roster:
        if self.roster is None:
            self.roster = roster_mod.load()
        return self.roster

    @staticmethod
    def _uid(event: AstrMessageEvent) -> str:
        """练度数据的归属：私聊是对方 QQ，群聊也是发消息那个人的 QQ。"""
        try:
            uid = str(event.get_sender_id() or "").strip()
        except Exception:
            uid = ""
        return uid or "unknown"

    # ── 合并转发 ─────────────────────────────────────────────────────
    async def _send_forward_nodes(
        self, event: AstrMessageEvent, items: list[tuple[str, list]]
    ) -> int | None:
        """把若干条消息打包成**一条合并转发（聊天记录）**发送，返回 message_id。

        items: ``[(节点显示名, [消息组件...]), ...]``

        不用 ``event.send(Nodes(...))``：框架源码里
        ``AiocqhttpMessageEvent.send_message`` 对 Nodes 分支丢弃了 ``call_action``
        的返回值，拿不到 message_id 就没法在需要时撤回。自己调一次更可控。

        ``event.bot`` 只有 aiocqhttp（OneBot）平台才有，其它平台直接抛错，
        由调用方降级成普通消息。
        """
        bot = getattr(event, "bot", None)
        if bot is None:
            raise RuntimeError("当前平台不支持合并转发（非 OneBot 协议端）")
        self_id = str(getattr(event.message_obj, "self_id", "") or "")
        if not self_id:
            raise RuntimeError("取不到机器人 self_id，无法构造合并转发")
        nodes = Nodes([Node(uin=self_id, name=name, content=content) for name, content in items])
        payload = await nodes.to_dict()
        gid = event.get_group_id()
        if gid:
            payload["group_id"] = str(gid)
            ret = await bot.call_action("send_group_forward_msg", **payload)
        else:
            payload["user_id"] = str(event.get_sender_id())
            ret = await bot.call_action("send_private_forward_msg", **payload)
        mid = (ret or {}).get("message_id")
        logger.info("[%s] 已发合并转发 %d 个节点 message_id=%s", PLUGIN_NAME, len(items), mid)
        return mid

    # ── 出图 ─────────────────────────────────────────────────────────
    async def _render(self, event: AstrMessageEvent, factory) -> Path:
        """线程里出图并返回临时文件路径。

        PIL 是纯 CPU 活（2x 卡片约 0.3~1s），直接跑会卡住事件循环里所有会话，
        所以丢进 ``asyncio.to_thread``。文件登记给框架，pipeline 结束时自动清理。
        """
        target = paths.user_data_dir() / "out" / f"nikke-{uuid.uuid4().hex[:12]}.png"
        target.parent.mkdir(parents=True, exist_ok=True)

        def work():
            image = factory()
            image.save(target)
            return target

        await asyncio.to_thread(work)
        event.track_temporary_local_file(str(target))
        return target

    # ── 角色解析 ─────────────────────────────────────────────────────
    def _find(self, query: str) -> tuple[dict | None, list[dict]]:
        return self._table().resolve(query)

    # ── /妮姬帮助 ────────────────────────────────────────────────────
    @filter.command("妮姬帮助")
    async def nikke_help(self, event: AstrMessageEvent):
        """命令总览。

        群聊里发成一条合并转发（帮助不短，直接发会刷屏），私聊发纯文本。
        合并转发失败（非 OneBot 平台、取不到 self_id、协议端拒绝）时
        自动退回纯文本 —— 宁可长一点，也不能让用户看不到帮助。
        """
        web = self._web_url()
        gid = ""
        try:
            gid = str(event.get_group_id() or "")
        except Exception:
            gid = ""
        if gid and self._use_forward():
            try:
                items = [(name, [Plain(body)]) for name, body in texts.help_nodes(web)]
                if await self._send_forward_nodes(event, items):
                    return
            except Exception as exc:
                logger.warning("[%s] 帮助合并转发失败，退回纯文本：%r", PLUGIN_NAME, exc)
        yield event.plain_result(texts.help_text(web))

    # ── /妮姬网址 ────────────────────────────────────────────────────
    @filter.command("妮姬网址")
    async def nikke_url(self, event: AstrMessageEvent):
        """要网页端地址（去那里录入练度并导出分享码）。"""
        web = self._web_url()
        if not web:
            yield event.plain_result(
                "网页端地址还没配置。\n"
                "请在 AstrBot 的插件配置里给「NIKKE练度统计助手」填上 web_base_url，"
                "保存后重载插件即可。"
            )
            return
        yield event.plain_result(f"网页端：{web}")

    # ── /妮姬导入 ────────────────────────────────────────────────────
    @filter.command("妮姬导入")
    async def nikke_import(self, event: AstrMessageEvent):
        """导入分享码：角色数据（补练度）和表格配置（定名单与行序）都走这里。"""
        args = _args(event, "妮姬导入")
        if not args:
            yield event.plain_result(texts.bad_args("/妮姬导入", "<分享码>"))
            return
        # 分享码可能被聊天软件换行/加空格，拼回去再解
        payload = "".join(args)
        try:
            result = sharecode.decode_share_code(payload)
        except sharecode.ShareCodeError as exc:
            yield event.plain_result(str(exc))
            return
        except Exception as exc:
            logger.exception("[%s] 分享码解析异常", PLUGIN_NAME)
            yield event.plain_result(f"分享码解析失败：{type(exc).__name__}: {exc}")
            return

        uid = self._uid(event)
        try:
            summary = store_mod.update(uid, lambda store: store_mod.merge_share_result(store, result))
        except Exception as exc:
            logger.exception("[%s] 写入存档失败", PLUGIN_NAME)
            yield event.plain_result(f"保存失败：{type(exc).__name__}: {exc}")
            return

        table = self._table()
        if summary["kind"] == "table":
            # 「还没导入」指的是**这个 QQ 自己的存档里没有**，不是角色表里没有
            absent = [code for code in summary["rows"] if code not in store_mod.load(uid)["characters"]]
            yield event.plain_result(texts.import_receipt(
                "table", 0, 0, None, [], absent, table_rows=len(summary["rows"])))
            return

        touched = summary["added"] + summary["updated"]
        names = [table.by_code[code]["nameCn"] for code in touched if code in table.by_code]
        yield event.plain_result(texts.import_receipt(
            "characters", len(summary["added"]), len(summary["updated"]),
            summary["synchroLevel"], names, [],
        ))

    # ── /妮姬列表 ────────────────────────────────────────────────────
    @filter.command("妮姬列表")
    async def nikke_list(self, event: AstrMessageEvent):
        """看自己已导入的角色：谁装备录完了（能进统计表）、谁还没录。"""
        store = store_mod.load(self._uid(event))
        table = self._table()
        rows = []
        for code, record in store["characters"].items():
            char = table.by_code.get(code)
            if char is None:
                continue
            complete = stats.is_fully_recorded(record)
            rows.append({
                "name": char.get("nameCn") or code,
                "element": stats.element_label(char.get("element")),
                "tierScore": stats.build_character_stats(record)["tierScore"] if complete else 0,
                "complete": complete,
            })
        rows.sort(key=lambda row: (not row["complete"], row["name"]))
        yield event.plain_result(texts.list_text(store["synchroLevel"], rows))

    # ── /妮姬面板 ────────────────────────────────────────────────────
    @filter.command("妮姬面板")
    async def nikke_panel(self, event: AstrMessageEvent):
        """出角色面板图（与网页端「导出图片」同一版式，2x = 1472×2192）。"""
        args = _args(event, "妮姬面板")
        if not args:
            yield event.plain_result(texts.bad_args("/妮姬面板", "<角色>"))
            return
        query = " ".join(args)
        char, candidates = self._find(query)
        if char is None:
            yield event.plain_result(
                texts.ambiguous_character(query, [item["nameCn"] for item in candidates])
                if candidates else texts.unknown_character(query)
            )
            return

        store = store_mod.load(self._uid(event))
        record = store["characters"].get(str(char["nameCode"]))
        if record is None:
            yield event.plain_result(texts.not_imported(char.get("nameCn") or "该角色"))
            return

        try:
            path = await self._render(event, lambda: card.render_card(
                char, record, scale=2,
                synchro_level=store["synchroLevel"], research=store["research"],
            ))
        except Exception as exc:
            logger.exception("[%s] 面板出图失败", PLUGIN_NAME)
            yield event.plain_result(texts.render_failed(exc))
            return
        yield event.image_result(str(path))

    # ── /妮姬练度统计 ────────────────────────────────────────────────
    def _stats_rows(self, store: dict, codes: list[str]) -> tuple[list[dict], list[str]]:
        """把存档里的角色凑成统计表的行。返回 ``(行, 被跳过的角色名)``。"""
        table = self._table()
        rows, skipped = [], []
        for code in codes:
            char = table.by_code.get(str(code))
            if char is None:
                continue
            record = store["characters"].get(str(code))
            if record is None or not stats.is_fully_recorded(record):
                skipped.append(char.get("nameCn") or str(code))
                continue
            rows.append({
                "name": char.get("nameCn") or str(code),
                "element": char.get("element"),
                "stats": stats.build_character_stats(record),
            })
        return rows, skipped

    def _default_table_codes(self, store: dict) -> list[str]:
        """没设过表格配置时的默认名单：全部已完善角色，按属性排列。

        排序规则与网页端的「按属性排列」一致（燃烧 → 水冷 → 风压 → 电击 → 铁甲，
        同属性内阶数降序），这样不出网页也能拿到一张排好的表。
        """
        table = self._table()
        complete = [
            code for code, record in store["characters"].items()
            if table.by_code.get(code) and stats.is_fully_recorded(record)
        ]
        complete.sort(key=lambda code: (
            stats.element_rank(table.by_code[code].get("element")),
            -stats.build_character_stats(store["characters"][code])["tierScore"],
        ))
        return complete

    @filter.command("妮姬练度统计")
    async def nikke_stats(self, event: AstrMessageEvent):
        """出一张练度统计表。名单与行序取 /妮姬练度统计设置 的配置。"""
        store = store_mod.load(self._uid(event))
        codes = store["statsTable"]["nameCodes"] or self._default_table_codes(store)
        if not codes:
            yield event.plain_result(
                "还没有能进表的角色。\n"
                "统计表只收「四件装备都录了词条」的角色，先在网页端把装备录完再导出分享码。"
            )
            return
        rows, skipped = self._stats_rows(store, codes)
        if not rows:
            yield event.plain_result(
                "表格配置里的角色都还没录满四件装备，出不了表。\n"
                "用 /妮姬练度统计设置 换一批，或在网页端把装备补完。"
            )
            return
        try:
            path = await self._render(event, lambda: stats.render_stats_table(rows, scale=2))
        except Exception as exc:
            logger.exception("[%s] 统计表出图失败", PLUGIN_NAME)
            yield event.plain_result(texts.render_failed(exc))
            return
        yield event.image_result(str(path))
        if skipped:
            shown = "、".join(skipped[:8])
            more = f" 等 {len(skipped)} 个" if len(skipped) > 8 else ""
            yield event.plain_result(f"表里跳过了装备没录完的角色：{shown}{more}")

    # ── /妮姬练度统计设置 ────────────────────────────────────────────
    @filter.command("妮姬练度统计设置")
    async def nikke_stats_config(self, event: AstrMessageEvent):
        """定练度统计表里有哪些角色、按什么顺序（顺序就是行序）。"""
        args = _args(event, "妮姬练度统计设置")
        if not args:
            yield event.plain_result(texts.bad_args(
                "/妮姬练度统计设置", "<角色> <角色> ...（按这个顺序排列）"))
            return

        store = store_mod.load(self._uid(event))
        codes: list[str] = []
        missing: list[str] = []
        for query in args:
            char, _candidates = self._find(query)
            if char is None:
                missing.append(query)
                continue
            code = str(char["nameCode"])
            if code not in codes:
                codes.append(code)
        if not codes:
            yield event.plain_result("这些名字一个都没对上，先 /妮姬列表 看看自己导入了谁。")
            return

        store_mod.update(self._uid(event), lambda current: store_mod.set_table_config(current, codes))
        _rows, skipped = self._stats_rows(store, codes)
        yield event.plain_result(texts.table_config_receipt(len(codes), skipped, missing))

    # ── 改数值：单角色 ───────────────────────────────────────────────

    async def _change_one(
        self, event: AstrMessageEvent, command: str, usage: str,
        label: str, low: int, high: int, changes_of, value_of=None,
    ):
        """单角色改数值的公共流程：解析角色 → 校验数值 → 写档 → 回执。

        ``changes_of(value)`` 返回要合并进记录的字段；``value_of`` 可把用户输入
        映射成另一个值（目前只有同步器等级用到，那边单独处理）。
        """
        args = _args(event, command)
        name, raw = _name_and_value(args)
        if not name or not raw:
            yield event.plain_result(texts.bad_args(command, usage))
            return
        if not re.fullmatch(r"[+-]?\d+", raw):
            yield event.plain_result(texts.bad_value(label, low, high))
            return
        value = int(raw)
        if not low <= value <= high:
            yield event.plain_result(texts.bad_value(label, low, high))
            return

        char, candidates = self._find(name)
        if char is None:
            yield event.plain_result(
                texts.ambiguous_character(name, [item["nameCn"] for item in candidates])
                if candidates else texts.unknown_character(name)
            )
            return

        uid = self._uid(event)
        try:
            store_mod.update(uid, lambda store: store_mod.update_record(
                store, char["nameCode"], changes_of(value)))
        except store_mod.StoreError:
            yield event.plain_result(texts.not_imported(char.get("nameCn") or name))
            return
        yield event.plain_result(texts.changed_receipt(
            label, value, name=char.get("nameCn") or name))

    async def _change_all(
        self, event: AstrMessageEvent, command: str, usage: str,
        label: str, low: int, high: int, changes_of,
    ):
        """一键改数值：只作用于**已导入**的角色。"""
        args = _args(event, command)
        if not args:
            yield event.plain_result(texts.bad_args(command, usage))
            return
        raw = args[0]
        if not re.fullmatch(r"[+-]?\d+", raw):
            yield event.plain_result(texts.bad_value(label, low, high))
            return
        value = int(raw)
        if not low <= value <= high:
            yield event.plain_result(texts.bad_value(label, low, high))
            return
        count = store_mod.update(self._uid(event), lambda store: store_mod.update_all_records(
            store, changes_of(value)))
        yield event.plain_result(texts.changed_receipt(label, value, count=count))

    # ── /妮姬同步器 ──────────────────────────────────────────────────
    @filter.command("妮姬同步器")
    async def nikke_synchro(self, event: AstrMessageEvent):
        """设同步器等级（存档级，全体妮姬共用）。"""
        args = _args(event, "妮姬同步器")
        if not args or not re.fullmatch(r"[+-]?\d+", args[0]):
            yield event.plain_result(texts.bad_args("/妮姬同步器", "<等级 1~2000>"))
            return
        level = int(args[0])
        if not store_mod.SYNCHRO_MIN <= level <= store_mod.SYNCHRO_MAX:
            yield event.plain_result(texts.bad_value(
                "同步器等级", store_mod.SYNCHRO_MIN, store_mod.SYNCHRO_MAX))
            return
        try:
            old, new = store_mod.update(
                self._uid(event), lambda store: store_mod.set_synchro_level(store, level))
        except store_mod.StoreError as exc:
            yield event.plain_result(str(exc))
            return
        yield event.plain_result(texts.synchro_receipt(old, new))

    # ── /妮姬好感 ────────────────────────────────────────────────────
    @filter.command("妮姬好感")
    async def nikke_affection(self, event: AstrMessageEvent):
        """改好感度。"""
        async for result in self._change_one(
            event, "妮姬好感", "<角色> <0~40>", "好感度",
            store_mod.AFFECTION_MIN, store_mod.AFFECTION_MAX,
            lambda value: {"affection": value},
        ):
            yield result

    # ── /妮姬星级 ────────────────────────────────────────────────────
    @filter.command("妮姬星级")
    async def nikke_grade(self, event: AstrMessageEvent):
        """改突破星级。"""
        async for result in self._change_one(
            event, "妮姬星级", "<角色> <0~3>", "星级",
            store_mod.GRADE_MIN, store_mod.GRADE_MAX,
            lambda value: {"limitBreak": {"grade": value}},
        ):
            yield result

    # ── /妮姬核心 ────────────────────────────────────────────────────
    @filter.command("妮姬核心")
    async def nikke_core(self, event: AstrMessageEvent):
        """改核心突破。"""
        async for result in self._change_one(
            event, "妮姬核心", "<角色> <0~7>", "核心",
            store_mod.CORE_MIN, store_mod.CORE_MAX,
            lambda value: {"limitBreak": {"core": value}},
        ):
            yield result

    # ── /妮姬技能1 / 2 / 爆裂 ────────────────────────────────────────
    async def _change_skill(self, event: AstrMessageEvent, command: str, key: str, label: str):
        async for result in self._change_one(
            event, command, "<角色> <1~10>", label,
            store_mod.SKILL_MIN, store_mod.SKILL_MAX,
            lambda value: {"skills": {key: value}},
        ):
            yield result

    @filter.command("妮姬技能1")
    async def nikke_skill1(self, event: AstrMessageEvent):
        """改技能 1。"""
        async for result in self._change_skill(event, "妮姬技能1", "skill1", "技能1"):
            yield result

    @filter.command("妮姬技能2")
    async def nikke_skill2(self, event: AstrMessageEvent):
        """改技能 2。"""
        async for result in self._change_skill(event, "妮姬技能2", "skill2", "技能2"):
            yield result

    @filter.command("妮姬爆裂")
    async def nikke_burst(self, event: AstrMessageEvent):
        """改爆裂技能。"""
        async for result in self._change_skill(event, "妮姬爆裂", "burst", "爆裂技能"):
            yield result

    # ── 一键：改所有已导入的角色 ─────────────────────────────────────

    @filter.command("妮姬一键好感度")
    async def nikke_all_affection(self, event: AstrMessageEvent):
        """一键改好感度。"""
        async for result in self._change_all(
            event, "妮姬一键好感度", "<0~40>", "好感度",
            store_mod.AFFECTION_MIN, store_mod.AFFECTION_MAX,
            lambda value: {"affection": value},
        ):
            yield result

    @filter.command("妮姬一键星级")
    async def nikke_all_grade(self, event: AstrMessageEvent):
        """一键改星级。"""
        async for result in self._change_all(
            event, "妮姬一键星级", "<0~3>", "星级",
            store_mod.GRADE_MIN, store_mod.GRADE_MAX,
            lambda value: {"limitBreak": {"grade": value}},
        ):
            yield result

    @filter.command("妮姬一键核心")
    async def nikke_all_core(self, event: AstrMessageEvent):
        """一键改核心。"""
        async for result in self._change_all(
            event, "妮姬一键核心", "<0~7>", "核心",
            store_mod.CORE_MIN, store_mod.CORE_MAX,
            lambda value: {"limitBreak": {"core": value}},
        ):
            yield result

    async def _change_all_skill(self, event: AstrMessageEvent, command: str, key: str, label: str):
        async for result in self._change_all(
            event, command, "<1~10>", label,
            store_mod.SKILL_MIN, store_mod.SKILL_MAX,
            lambda value: {"skills": {key: value}},
        ):
            yield result

    @filter.command("妮姬一键技能1")
    async def nikke_all_skill1(self, event: AstrMessageEvent):
        """一键改技能 1。"""
        async for result in self._change_all_skill(event, "妮姬一键技能1", "skill1", "技能1"):
            yield result

    @filter.command("妮姬一键技能2")
    async def nikke_all_skill2(self, event: AstrMessageEvent):
        """一键改技能 2。"""
        async for result in self._change_all_skill(event, "妮姬一键技能2", "skill2", "技能2"):
            yield result

    @filter.command("妮姬一键爆裂")
    async def nikke_all_burst(self, event: AstrMessageEvent):
        """一键改爆裂技能。"""
        async for result in self._change_all_skill(event, "妮姬一键爆裂", "burst", "爆裂技能"):
            yield result

    # ── /妮姬自检 ────────────────────────────────────────────────────
    @filter.command("妮姬自检")
    async def nikke_selftest(self, event: AstrMessageEvent):
        """框架自检：角色表 / 素材 / 字体 / PIL / 数据目录 / 别名表 / 自己的存档。"""
        t0 = time.time()
        lines = [f"NIKKE练度统计助手 v{VERSION} 自检", ""]

        # 角色表
        if self.roster is None:
            try:
                self.roster = roster_mod.load()
            except Exception as exc:
                self.load_error = f"{type(exc).__name__}: {exc}"
        if self.roster is None:
            lines.append(f"[缺] 角色表：{self.load_error or '未加载'}")
            lines.append(f"     期望位置：{paths.ROSTER_FILE}")
        else:
            info = self.roster.summary()
            lines.append(
                f"[OK] 角色表：{info['characters']} 个角色"
                f"（国服 {info['cnAvailable']} / 珍藏品 {info['collectibleCn']}）"
            )
            lines.append(f"     revision {info['revision'] or '未知'}，索引 {info['index']} 条")

            # 素材抽查：第一张头像 + 默认立绘 + 该角色第一个技能图标
            probe = self.roster.characters[0]
            checks = [("头像", probe.get("avatar")), ("立绘", self.roster.default_artwork(probe))]
            icons = probe.get("skillIcons") or {}
            if icons:
                checks.append(("技能图标", next(iter(icons.values()))))
            missing = [f"{label}({rel})" for label, rel in checks if rel and not paths.asset_exists(rel)]
            lines.append(
                "[OK] 素材抽查：头像 / 立绘 / 技能图标均在位" if not missing
                else "[缺] 素材缺失：" + "、".join(missing)
            )

        # 字体
        fonts = [name for name in FONT_FILES if (paths.FONT_DIR / name).is_file()]
        if len(fonts) == len(FONT_FILES):
            sizes = "、".join(
                f"{name} {int((paths.FONT_DIR / name).stat().st_size / 1024)}KB"
                for name in FONT_FILES
            )
            lines.append(f"[OK] 字体：{sizes}")
        else:
            lack = [name for name in FONT_FILES if name not in fonts]
            lines.append(f"[缺] 字体缺失：{'、'.join(lack)}（放在 {paths.FONT_DIR}）")

        # Pillow
        try:
            import PIL

            lines.append(f"[OK] Pillow：{getattr(PIL, '__version__', '未知')}，出图可用")
        except Exception as exc:
            lines.append(f"[缺] Pillow 不可用：{exc!r}")

        # 数据目录
        data_dir = paths.user_data_dir()
        try:
            probe_file = data_dir / ".selftest"
            probe_file.write_text("ok", encoding="utf-8")
            probe_file.unlink()
            lines.append(f"[OK] 数据目录可写：{data_dir}")
        except Exception as exc:
            lines.append(f"[缺] 数据目录不可写：{data_dir}（{exc!r}）")

        # 别名表
        alias_file = paths.aliases_path()
        if not alias_file.is_file():
            lines.append(f"[--] 别名表还没建：{alias_file}")
        else:
            aliases = self.roster.load_aliases() if self.roster else {}
            lines.append(
                f"[OK] 别名表：{len(aliases)} 个角色有别名（改动实时生效，无需重载）"
            )

        # 自己的存档
        uid = self._uid(event)
        store = store_mod.load(uid)
        store_file = store_mod.user_store_path(uid)
        total = len(store["characters"])
        complete = sum(1 for record in store["characters"].values()
                       if stats.is_fully_recorded(record))
        lines.append(
            f"[OK] 你的存档：已导入 {total} 个角色（装备已录入 {complete}），"
            f"同步器 LV.{store['synchroLevel']}"
        )
        lines.append(f"     文件：{store_file}（{'已存在' if store_file.is_file() else '还没有，导入一次就有了'}）")
        rows = store["statsTable"]["nameCodes"]
        lines.append(f"     表格配置：{len(rows)} 行" + ("（没设过，出表时按属性排列全部已完善角色）" if not rows else ""))

        # 运行环境
        gid = ""
        try:
            gid = str(event.get_group_id() or "")
        except Exception:
            gid = ""
        lines.append(
            f"[--] 会话：{'群聊 ' + gid if gid else '私聊'} / "
            f"合并转发 {'支持' if getattr(event, 'bot', None) else '不支持'}"
        )
        lines.append(f"[--] 耗时 {int((time.time() - t0) * 1000)} ms")
        yield event.plain_result("\n".join(lines))
