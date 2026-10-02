r"""跨语言核对：网页端（JS）编出来的分享码，BOT 端（Python）能不能解成同一份数据。

    node app/scripts/check-share-code.mjs --vectors <向量文件>
    python <这个脚本> <向量文件>

向量文件是 ``[{ "label", "code", "expect" }, ...]``，``expect`` 就是 JS 侧
``decodeShareCode`` 的结果。这里用插件的 ``core/sharecode.py`` 解一遍，逐字段对照。

为什么值得单独做个跨语言核对：编码在浏览器、解码在 BOT，两边各写一份位打包逻辑，
只要有一处位宽或字段顺序不一致，用户就会看到「导入后数据串了」这种最难查的错。
"""
from __future__ import annotations

import json
import sys

PLUGIN_DIR = "/AstrBot/data/plugins/astrbot_plugin_nikke_roster"
if len(sys.argv) > 2:
    PLUGIN_DIR = sys.argv[2]
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from core.sharecode import ShareCodeError, decode_share_code  # noqa: E402


def diff(expected, actual, path: str = "$") -> list[str]:
    """递归比对，返回差异描述。数字按数值比（JS 的 9.0 到了 JSON 里就是 9）。"""
    out: list[str] = []
    if isinstance(expected, bool) or isinstance(actual, bool):
        if expected != actual:
            out.append(f"{path}: 期望 {expected!r}，实际 {actual!r}")
    elif isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if abs(float(expected) - float(actual)) > 1e-9:
            out.append(f"{path}: 期望 {expected!r}，实际 {actual!r}")
    elif isinstance(expected, dict) and isinstance(actual, dict):
        for key in sorted(set(expected) | set(actual)):
            if key not in expected:
                out.append(f"{path}.{key}: Python 多出 {actual[key]!r}")
            elif key not in actual:
                out.append(f"{path}.{key}: Python 缺少（期望 {expected[key]!r}）")
            else:
                out += diff(expected[key], actual[key], f"{path}.{key}")
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            out.append(f"{path}: 长度 期望 {len(expected)}，实际 {len(actual)}")
        else:
            for index, (left, right) in enumerate(zip(expected, actual)):
                out += diff(left, right, f"{path}[{index}]")
    elif expected != actual:
        out.append(f"{path}: 期望 {expected!r}，实际 {actual!r}")
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python check_share_code.py <向量文件> [插件目录]")
        return 2

    with open(sys.argv[1], encoding="utf-8") as handle:
        payload = json.load(handle)
    vectors = payload.get("vectors") or []

    bad = 0
    for item in vectors:
        label, code, expect = item.get("label"), item.get("code"), item.get("expect")
        try:
            actual = decode_share_code(code)
        except ShareCodeError as exc:
            bad += 1
            print(f"[FAIL] {label}: Python 解码报错：{exc}")
            continue
        differences = diff(expect, actual)
        if differences:
            bad += 1
            print(f"[FAIL] {label}:")
            for line in differences[:6]:
                print(f"        {line}")

    total = len(vectors)
    print()
    if bad:
        print(f"跨语言核对失败：{bad}/{total} 条不一致")
        return 1
    print(f"跨语言核对通过：{total} 条向量，JS 编码 == Python 解码")
    return 0


if __name__ == "__main__":
    sys.exit(main())
