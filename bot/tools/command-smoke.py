r"""容器内指令冒烟：拿假 event 把 ``main.py`` 的指令从头跑一遍。

    python /AstrBot/data/nikke_tools/command-smoke.py <插件目录> <分享码向量文件>

为什么要有这一层：出图、存档、名字解析各自单测都过了，但**拼成命令**之后最容易
出事的地方是「取参数的切片 / yield 了几条 / event 上到底叫什么属性」，
这些只有真跑一遍才看得见。需要 QQ 才能验的部分（合并转发、协议端发送）这里不碰。

覆盖：导入角色数据与表格配置 → 列表 → 面板出图 → 练度统计出图 →
      单角色改数值 → 一键改数值 → 参数与角色名的各种报错分支。

跑完会把这次用的测试 QQ（10001）存档和出图都删掉，不留在服务器上。
"""
from __future__ import annotations

import asyncio
import importlib
import json
import shutil
import sys
from pathlib import Path

PLUGIN_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else "/AstrBot/data/plugins/astrbot_plugin_nikke_roster")
VECTOR_FILE = Path(sys.argv[2] if len(sys.argv) > 2 else "/AstrBot/data/nikke_tools/sharecode-vectors.json")
TEST_UID = "10001"

if str(PLUGIN_DIR.parent) not in sys.path:
    sys.path.insert(0, str(PLUGIN_DIR.parent))

MODULE_NAME = "astrbot_plugin_nikke_roster.main"

#: 命令名 → 方法名。下面会断言这张表和帮助里的命令清单严格一致，
#: 加了新命令却忘了加进来会直接报错，不会静默漏测。
METHODS = {
    "妮姬帮助": "nikke_help",
    "妮姬网址": "nikke_url",
    "妮姬自检": "nikke_selftest",
    "妮姬导入": "nikke_import",
    "妮姬列表": "nikke_list",
    "妮姬面板": "nikke_panel",
    "妮姬练度统计": "nikke_stats",
    "妮姬练度统计设置": "nikke_stats_config",
    "妮姬同步器": "nikke_synchro",
    "妮姬好感": "nikke_affection",
    "妮姬星级": "nikke_grade",
    "妮姬核心": "nikke_core",
    "妮姬技能1": "nikke_skill1",
    "妮姬技能2": "nikke_skill2",
    "妮姬爆裂": "nikke_burst",
    "妮姬一键好感度": "nikke_all_affection",
    "妮姬一键星级": "nikke_all_grade",
    "妮姬一键核心": "nikke_all_core",
    "妮姬一键技能1": "nikke_all_skill1",
    "妮姬一键技能2": "nikke_all_skill2",
    "妮姬一键爆裂": "nikke_all_burst",
}


class Reply:
    """假的指令返回值，只为把「文本 / 图片」和内容记下来。"""

    def __init__(self, kind: str, body: str):
        self.kind = kind
        self.body = body

    def __repr__(self) -> str:
        shown = Path(self.body).name if self.kind == "image" else self.body
        return f"<{self.kind} {shown!r}>"


class FakeEvent:
    """只实现指令里实际用到的那几个属性。

    刻意不做成「完整的 AstrMessageEvent」——用到什么就实现什么，
    多出来的能力只会让测试看起来比实际覆盖得多。
    """

    def __init__(self, text: str, uid: str = TEST_UID, group: str = ""):
        self._text = text
        self._uid = uid
        self._group = group
        self.tracked: list[str] = []

    def get_message_str(self) -> str:
        return self._text

    def get_sender_id(self) -> str:
        return self._uid

    def get_group_id(self) -> str:
        return self._group

    def plain_result(self, text: str) -> Reply:
        return Reply("text", text)

    def image_result(self, path: str) -> Reply:
        return Reply("image", path)

    def track_temporary_local_file(self, path: str) -> None:
        self.tracked.append(str(path))


def main() -> int:
    module = importlib.import_module(MODULE_NAME)
    # 直接用 main 里已经导入好的那几个模块对象，免得两处 import 出两份状态
    texts, store_mod = module.texts, module.store_mod

    # ── 先自检测试脚本本身 ───────────────────────────────────────────
    help_commands = {
        name.split(" ")[0].lstrip("/") for _title, items in texts.COMMAND_GROUPS for name, _desc in items
    }
    assert help_commands == set(METHODS), (
        "帮助里列的命令和冒烟表对不上："
        f"帮助多 {help_commands - set(METHODS)}，冒烟多 {set(METHODS) - help_commands}"
    )
    for method in METHODS.values():
        assert hasattr(module.NikkeRosterPlugin, method), f"插件上没有 {method}"

    plugin = module.NikkeRosterPlugin(None, {"web_base_url": "https://nikke.example.com"})
    asyncio.run(plugin.initialize())

    vectors = json.loads(VECTOR_FILE.read_text(encoding="utf-8"))["vectors"]
    char_vector = max(
        (v for v in vectors if v["expect"]["payloadType"] == 0),
        key=lambda v: len(v["expect"]["characters"]),
    )
    table_vector = next(v for v in vectors if v["expect"]["payloadType"] == 1)

    failures: list[str] = []
    checks = 0

    def check(label: str, ok: bool, detail: str = "") -> None:
        nonlocal checks
        checks += 1
        if ok:
            print(f"  [OK]   {label}")
        else:
            print(f"  [FAIL] {label}" + (f"  <- {detail}" if detail else ""))
            failures.append(label)

    def text_of(replies: list[Reply]) -> str:
        return "\n".join(item.body for item in replies if item.kind == "text")

    def images_of(replies: list[Reply]) -> list[str]:
        return [item.body for item in replies if item.kind == "image"]

    async def call_with_event(text: str) -> tuple[list[Reply], FakeEvent]:
        method = METHODS[text.split(" ")[0].lstrip("/")]
        event = FakeEvent(text)
        return [item async for item in getattr(plugin, method)(event)], event

    def call(text: str) -> list[Reply]:
        return asyncio.run(call_with_event(text))[0]

    def text_call(text: str) -> str:
        return text_of(call(text))

    try:
        # ── 1. 静态指令 ─────────────────────────────────────────────
        print("1) 帮助 / 网址 / 自检 / 列表 / 面板（空档）")
        body = text_call("妮姬帮助")
        check("帮助里有新命令", "妮姬导入" in body and "妮姬一键爆裂" in body)

        body = text_call("妮姬网址")
        check("网址取到配置里的地址", "https://nikke.example.com" in body, body[:60])

        body = text_call("妮姬自检")
        check("自检跑通并报出自己的存档", "[OK] 你的存档" in body and "[OK] 角色表" in body)

        body = text_call("妮姬列表")
        check("空档列表给引导语", "还没有导入任何角色数据" in body, body[:60])

        body = text_call("妮姬面板 拉毗")
        check("没导入的角色提示先导入", "还没导入过数据" in body or "没找到叫" in body, body[:80])

        body = text_call("妮姬面板 不存在的名字")
        check("认不出的角色有提示", "没找到叫" in body, body[:80])

        body = text_call("妮姬面板")
        check("面板缺参数报用法", "用法：" in body, body[:60])

        # ── 2. 导入分享码 ───────────────────────────────────────────
        print("2) 导入角色数据")
        body = text_call(f"妮姬导入 {char_vector['code']}")
        check("导入回执有新增数", "导入完成：新增" in body, body[:80])

        store = store_mod.load(TEST_UID)
        codes = sorted(store["characters"])
        expect_count = len(char_vector["expect"]["characters"])
        check("存档里角色数对上", len(codes) == expect_count, f"{len(codes)} vs {expect_count}")
        name = plugin.roster.by_code[codes[0]]["nameCn"]

        body = text_call("妮姬列表")
        check("列表报出导入数量与同步器", "已导入" in body and "同步器 LV." in body, body[:80])

        # ── 3. 面板出图 ─────────────────────────────────────────────
        print("3) 面板出图")
        replies, event = asyncio.run(call_with_event(f"妮姬面板 {name}"))
        paths = images_of(replies)
        check("返回一条图片", len(paths) == 1, repr(replies)[:120])
        if paths:
            from PIL import Image

            with Image.open(paths[0]) as image:
                check("图片是 2x 卡片尺寸 1472×2192", image.size == (1472, 2192), str(image.size))
            check("出图登记给了框架清理", paths[0] in event.tracked, repr(event.tracked))

        # ── 4. 练度统计 ─────────────────────────────────────────────
        print("4) 练度统计")
        # 先把自己造一个「四件装备全录满」的角色：这才是练度统计的真实使用场景，
        # 而分享码向量里没有这种满配数据（装备词条只能从网页端 OCR/手填进来）
        filled = [[{"functionType": "StatAtk", "level": 15, "value": 14.63} for _ in range(3)] for _ in range(4)]

        def force_complete(store):
            store["characters"][codes[0]] = {**store["characters"][codes[0]], "equipments": filled}
            return None

        store_mod.update(TEST_UID, force_complete)
        replies = call("妮姬练度统计")
        paths = images_of(replies)
        check("出表（有已完善角色）", len(paths) == 1, repr(replies)[:120])
        if paths:
            from PIL import Image

            with Image.open(paths[0]) as image:
                check("统计表比卡片宽（9 列）", image.width > 800 and image.height > 100, str(image.size))

        body = text_call(f"妮姬练度统计设置 {name}")
        check("设置表格有回执", "表格配置好了" in body, body[:80])
        # 名单里再塞一个装备没录完的：应该照常出表，另外补一条「跳过了谁」
        other = [c for c in codes if c != codes[0]][0]
        other_name = plugin.roster.by_code[other]["nameCn"]
        replies = call(f"妮姬练度统计设置 {name} {other_name}")
        check("配置里掺入没录完的角色也不报错", "表格配置好了" in text_of(replies), repr(replies)[:120])
        replies = call("妮姬练度统计")
        check("出表 + 一条跳过说明",
              len(images_of(replies)) == 1 and "跳过了" in text_of(replies), repr(replies)[:160])

        body = text_call("妮姬练度统计设置 不存在甲乙丙")
        check("全都认不出时报错", "一个都没对上" in body, body[:80])

        body = text_call(f"妮姬导入 {table_vector['code']}")
        check("表格配置载荷被识别", "收到表格配置" in body, body[:80])

        # ── 5. 改数值 ───────────────────────────────────────────────
        print("5) 改数值")
        body = text_call(f"妮姬好感 {name} 35")
        check("改好感度成功", "好感度改成 35" in body, body[:80])
        check("存档里确实是 35", store_mod.load(TEST_UID)["characters"][codes[0]]["affection"] == 35)

        body = text_call(f"妮姬好感 {name} 99")
        check("好感度越界被拦", "0~40" in body, body[:80])

        body = text_call(f"妮姬好感 {name} abc")
        check("非数字被拦", "0~40" in body, body[:80])

        body = text_call("妮姬好感 拉毗 10")
        check("没导入的角色改不动", "还没导入过数据" in body or "没找到叫" in body, body[:80])

        body = text_call(f"妮姬星级 {name} 3")
        check("改星级成功", "星级改成 3" in body, body[:80])

        body = text_call(f"妮姬核心 {name} 7")
        check("改核心成功", "核心改成 7" in body, body[:80])

        skill2_before = store["characters"][codes[0]]["skills"]["skill2"]
        body = text_call(f"妮姬技能1 {name} 10")
        check("改技能1成功", "技能1改成 10" in body, body[:80])
        after = store_mod.load(TEST_UID)["characters"][codes[0]]["skills"]
        check("技能只动自己那个键", after["skill1"] == 10 and after["skill2"] == skill2_before,
              repr(after))

        body = text_call("妮姬爆裂 abc")
        check("爆裂缺数值报用法", "用法：" in body, body[:80])

        body = text_call("妮姬同步器 500")
        check("改同步器成功", "LV.200 → LV.500" in body, body[:80])

        body = text_call("妮姬同步器 9999")
        check("同步器越界被拦", "1~2000" in body, body[:80])

        # ── 6. 一键 ─────────────────────────────────────────────────
        print("6) 一键改数值")
        body = text_call("妮姬一键好感度 20")
        check("一键好感度成功", f"已把 {len(codes)} 个已导入角色" in body, body[:80])
        check("确实全改了",
              all(r["affection"] == 20 for r in store_mod.load(TEST_UID)["characters"].values()))

        body = text_call("妮姬一键星级 5")
        check("一键星级越界被拦", "0~3" in body, body[:80])
        body = text_call("妮姬一键技能2 12")
        check("一键技能越界被拦", "1~10" in body, body[:80])
        body = text_call("妮姬一键爆裂 9")
        check("一键爆裂成功", "爆裂技能改成 9" in body, body[:80])

        # ── 7. 坏分享码 ─────────────────────────────────────────────
        print("7) 坏分享码")
        body = text_call("妮姬导入 这不是码")
        check("格式不对有提示", "分享码格式不正确" in body, body[:80])
        broken = char_vector["code"][:-6] + "AAAAAA"
        body = text_call(f"妮姬导入 {broken}")
        check("CRC 坏掉有提示", "损坏" in body or "版本" in body, body[:80])

        print()
        print(f"指令冒烟：{checks - len(failures)}/{checks} 通过")
        for item in failures:
            print(f"  FAILED: {item}")
        return 1 if failures else 0
    finally:
        # 测试 QQ 的存档与出图都不留在服务器上
        path = store_mod.user_store_path(TEST_UID)
        if path.is_file():
            path.unlink()
        shutil.rmtree(Path(store_mod.paths.user_data_dir()) / "out", ignore_errors=True)
        print(f"已清理测试数据：{path.parent}")


if __name__ == "__main__":
    sys.exit(main())
