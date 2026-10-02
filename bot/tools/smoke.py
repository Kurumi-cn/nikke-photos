r"""冒烟测试：角色表装载 + 名字解析 + 别名表读取。

在容器里直接跑插件的 ``core`` 模块（不经过 AstrBot 的插件加载），
所以能在 QQ 上试命令之前就把解析逻辑验一遍：

    sudo -n docker exec astrbot python /AstrBot/data/nikke_tools/smoke.py

（本文件被放到 ``data/nikke_tools/`` 而不是容器的 /tmp —— 容器只挂载了
 ``data/``，host 的 /tmp 在容器里根本看不见。）

可选参数：插件目录（默认就是部署后的实际路径）。

验的东西：
  1. 角色表能读进来，nameCode 是唯一键
  2. 每个角色的「中文名 / nameCode」都能解析回它自己
  3. 别名表里的每一条别名都能解析到它所属的角色（不是别的角色）
  4. 素材抽查（头像 / 默认立绘）

退出码非 0 = 有硬失败（角色表读不了、名字解析回错角色）。
"""
from __future__ import annotations

import sys

PLUGIN_DIR = sys.argv[1] if len(sys.argv) > 1 else "/AstrBot/data/plugins/astrbot_plugin_nikke_roster"
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from core import paths  # noqa: E402
from core import roster as roster_mod  # noqa: E402

hard_fail = 0
soft_fail = 0


def fail(msg: str, hard: bool = False) -> None:
    global hard_fail, soft_fail
    if hard:
        hard_fail += 1
        print(f"[FAIL] {msg}")
    else:
        soft_fail += 1
        print(f"[warn] {msg}")


# ── 1. 角色表 ────────────────────────────────────────────────────────
try:
    table = roster_mod.load()
except Exception as exc:
    print(f"[FAIL] 角色表读不进来：{exc!r}")
    print(f"       期望位置：{paths.ROSTER_FILE}")
    sys.exit(1)

info = table.summary()
print(f"角色表：{info['characters']} 个角色，索引 {info['index']} 条，revision {info['revision']}")

codes = [str(c["nameCode"]) for c in table.characters]
if len(codes) != len(set(codes)):
    fail("nameCode 有重复，角色表作为主键不成立", hard=True)

# ── 2. 中文名 / nameCode 自解析 ──────────────────────────────────────
name_miss = []
for char in table.characters:
    for query in (char["nameCn"], str(char["nameCode"])):
        hit, candidates = table.resolve(query)
        if hit is None:
            name_miss.append(f"{query}（{'歧义 ' + str(len(candidates)) + ' 个候选' if candidates else '无命中'}）")
        elif str(hit["nameCode"]) != str(char["nameCode"]):
            name_miss.append(f"{query} -> 解析成了 {hit['nameCn']}")
if name_miss:
    fail(f"{len(name_miss)} 处自解析不通过：{'；'.join(name_miss[:6])}", hard=True)
else:
    print(f"自解析：{len(codes)}×2 条查询全部命中自己")

# ── 3. 别名表 ────────────────────────────────────────────────────────
alias_file = paths.aliases_path()
aliases = table.load_aliases()
owners = table.alias_owners()
shared = {key: codes for key, codes in owners.items() if len(codes) > 1}

print(f"别名表：{alias_file}")
print(f"         {len(aliases)} 个角色带别名，共 {sum(len(v) for v in aliases.values())} 条")
if shared:
    print(f"         其中 {len(shared)} 条别名被多个角色共用（会提示歧义，不算错）：")
    for key, codes in list(shared.items())[:8]:
        print(f"           {key} -> " + "、".join(table.by_code[c]["nameCn"] for c in codes))

alias_bad = []
for code, items in aliases.items():
    for alias in items:
        if roster_mod.normalize(alias) in shared:
            continue  # 共享别名走下面的歧义分支
        hit, candidates = table.resolve(alias)
        if hit is None:
            alias_bad.append(f"{alias}（{'歧义 ' + str(len(candidates)) + ' 个' if candidates else '无命中'}）")
        elif str(hit["nameCode"]) != str(code):
            alias_bad.append(f"{alias} -> {hit['nameCn']}（期望 {table.by_code[code]['nameCn']}）")

# 共享别名必须报歧义，且候选齐全 —— 不能静默挑一个
for key, codes in shared.items():
    hit, candidates = table.resolve(key)
    if hit is not None or len(candidates) != len(codes):
        alias_bad.append(f"{key} 是共享别名，但没有报歧义（hit={hit}）")

if alias_bad:
    fail(f"{len(alias_bad)} 条别名解析不对：{'；'.join(alias_bad[:6])}")
else:
    print("别名解析：全部指向正确角色")

# ── 4. 素材抽查 ──────────────────────────────────────────────────────
probe = table.characters[0]
missing = [
    label
    for label, rel in (("头像", probe.get("avatar")), ("默认立绘", table.default_artwork(probe)))
    if rel and not paths.asset_exists(rel)
]
for char in table.characters:
    art = table.default_artwork(char)
    if not art or not paths.asset_exists(art):
        missing.append(f"立绘 {char['nameCn']}")
if missing:
    fail(f"素材缺失 {len(missing)} 项：{'；'.join(missing[:6])}")
else:
    print(f"素材：{len(table.characters)} 张默认立绘 + 头像抽查全部在位")

print()
print(f"结果：硬失败 {hard_fail}，软失败 {soft_fail}")
sys.exit(1 if hard_fail else 0)
