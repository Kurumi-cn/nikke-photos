r"""本地预览出图：把几张角色卡渲染成 PNG，用来肉眼比对版式（不需要服务器）。

    python bot/tools/render-preview.py [输出目录]

用的是**真实素材**（app/public）与**真实字体**（插件 assets/fonts），
所以本地看到的就是 BOT 出图的样子，改版式时可以快速迭代。
"""
from __future__ import annotations

import sys
from pathlib import Path

BOT_DIR = Path(__file__).resolve().parent.parent
PLUGIN_DIR = BOT_DIR / "astrbot_plugin_nikke_roster"
if str(PLUGIN_DIR) not in sys.path:
    sys.path.insert(0, str(PLUGIN_DIR))

from core import card, cardlayout, gamedata, paths, roster as roster_mod, stats  # noqa: E402

# 素材只部署在服务器上，本地源码树里没有那 104MB；
# 指到网页端的 app/public（相对路径完全一致），就不用拷一份素材才能看图
paths.FALLBACK_ASSETS_DIR = BOT_DIR.parent / "app" / "public"
if not paths.FALLBACK_ASSETS_DIR.is_dir():
    print(f"备用素材目录不存在：{paths.FALLBACK_ASSETS_DIR}")
    sys.exit(1)

OUT_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else BOT_DIR / "seed" / "preview"


def equipment(name: str, tiers: list[int | None]) -> list[dict | None]:
    """词条数值不传输，由「类型 + 档位」查表推出 —— 这里照分享码解码后的样子构造。"""
    return [
        {"functionType": name, "level": tier, "value": gamedata.affix_tier_value(name, tier)} if tier else None
        for tier in tiers
    ]


FULL_RECORD = {
    "limitBreak": {"grade": 3, "core": 7},
    "affection": 30,
    "combat": 114514,
    "skills": {"skill1": 10, "skill2": 10, "burst": 10},
    "cube": {"resourceId": 10003, "level": 15},
    "favoriteItem": {"rarity": "SSR", "level": 2},
    "equipments": [
        equipment("IncElementDmg", [15, 12, 10]),
        equipment("StatAtk", [15, 15, 9]),
        equipment("StatCritical", [13, 7, None]),
        equipment("StatCriticalDamage", [10, 5, 3]),
    ],
}
PLAIN_RECORD = {
    "limitBreak": {"grade": 2, "core": 4},
    "affection": 12,
    "combat": 98765,
    "skills": {"skill1": 8, "skill2": 7, "burst": 9},
    "cube": {"resourceId": 10004, "level": 10},
    "favoriteItem": {"rarity": "SR", "level": 15},
    "equipments": [
        equipment("StatAtk", [11, 6, 2]),
        equipment("StatAmmoLoad", [15, 15, None]),
        equipment("StatDef", [8, None, None]),
        equipment("StatCritical", [4, 1, None]),
    ],
}
EMPTY_RECORD = {
    "limitBreak": {"grade": 0, "core": 0},
    "affection": 0,
    "combat": 1,
    "skills": {"skill1": 1, "skill2": 1, "burst": 1},
    "cube": {"resourceId": 10001, "level": 1},
    "favoriteItem": {"rarity": "R", "level": 1},
    "equipments": [[None, None, None] for _ in range(4)],
}


def main() -> int:
    table = roster_mod.load()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    cases = [
        ("5007", FULL_RECORD, "珍藏品SSR-满配"),
        ("5145", PLAIN_RECORD, "长名字"),
        ("3001", EMPTY_RECORD, "低号-空装备"),
    ]
    for code, record, label in cases:
        char = table.by_code.get(code)
        if char is None:
            print(f"角色表里没有 {code}，跳过")
            continue
        image = card.render_card(char, record, scale=2, synchro_level=200, research={
            "class": {"Attacker": 200, "Defender": 200, "Supporter": 200},
            "corporation": {"ELYSION": 200, "MISSILIS": 200, "TETRA": 200, "PILGRIM": 200, "ABNORMAL": 200},
        })
        target = OUT_DIR / f"{code}-{label}.png"
        image.save(target)
        print(f"{target}  {image.width}x{image.height}")

    # 全模块关掉只剩装备，检查空态与模块开关是否生效
    char = table.by_code["5007"]
    modules = cardlayout.default_modules()
    for key in ("favoriteItem", "skills", "cube", "affection", "combat", "metadata"):
        modules[key] = False
    image = card.render_card(char, FULL_RECORD, scale=2, modules=modules, synchro_level=200)
    target = OUT_DIR / "5007-模块精简.png"
    image.save(target)
    print(f"{target}  {image.width}x{image.height}")

    # 练度统计表：五种属性各一个 + 最后一行极端档位，检查表头/边框/属性色/变色（≥40 蓝字、≥52 黑底）
    table_codes = ["5007", "5023", "5020", "5031", "5019", "5180"]
    EXTREME_RECORD = {
        **FULL_RECORD,
        # 攻击档位和 72（≥52 → 黑底蓝字）、暴率 45（≥40 → 蓝字）
        "equipments": [
            equipment("StatAtk", [15, 15, 8]),
            equipment("StatAtk", [15, 9, None]),
            equipment("StatCritical", [15, 15, 15]),
            equipment("StatAtk", [7, 3, None]),
        ],
    }
    table_rows = []
    for index, code in enumerate(table_codes):
        char = table.by_code.get(code)
        if char is None:
            print(f"⚠ 角色表里没有 {code}，跳过（统计表行数会比你写少一个）")
            continue
        record = EXTREME_RECORD if index == len(table_codes) - 1 else (FULL_RECORD if index % 2 == 0 else PLAIN_RECORD)
        table_rows.append({
            "name": char["nameCn"],
            "element": char["element"],
            "stats": stats.build_character_stats(record),
        })
    table_image = stats.render_stats_table(table_rows, scale=2)
    target = OUT_DIR / "stats-练度统计.png"
    table_image.save(target)
    print(f"{target}  {table_image.width}x{table_image.height}")

    missing = card.missing_assets()
    print()
    if missing:
        print(f"读不到的素材 {len(missing)} 个：")
        for item in missing[:20]:
            print(f"  {item}")
    else:
        print("素材全部就位")
    print(f"输出目录：{OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
