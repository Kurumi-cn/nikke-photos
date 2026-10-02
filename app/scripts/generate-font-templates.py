# 用真实字体渲染 OCR 字模（数字 / 任意文本），供 ocr-scan.mjs --digit-dir 使用
# 用法：python scripts/generate-font-templates.py --font <字体路径> --out <输出目录> [--size 96] [--texts digits|labels]
# 说明：输出为黑字白底的 RGB PNG（ocr-scan 会按亮度自动取墨迹，与颜色无关）
from __future__ import annotations

import argparse
import os

from PIL import Image, ImageDraw, ImageFont

DIGITS = [
    ("0", "0"), ("1", "1"), ("2", "2"), ("3", "3"), ("4", "4"),
    ("5", "5"), ("6", "6"), ("7", "7"), ("8", "8"), ("9", "9"),
    ("dot", "."), ("percent", "%"),
]

LABELS = [
    ("lv", "LV."),
    ("battle", "BATTLE"),
    ("label_hp", "体力"),
    ("label_atk", "攻击力"),
    ("label_def", "防御力"),
    ("label_level", "等级"),
    ("label_affection", "好感"),
    ("label_equip", "装备"),
    ("label_cube", "魔方"),
    ("label_research", "研究所"),
]


def render_text(font_path: str, text: str, size: int, out_path: str, stroke: int = 0) -> None:
    font = ImageFont.truetype(font_path, size)
    canvas = Image.new("L", (size * (len(text) + 3) + stroke * 4, size * 3 + stroke * 4), 255)
    draw = ImageDraw.Draw(canvas)
    draw.text((size // 2, size), text, font=font, fill=0, stroke_width=stroke, stroke_fill=0)
    ink_box = Image.eval(canvas, lambda value: 255 - value).getbbox()
    if not ink_box:
        raise SystemExit(f"渲染为空：{text} @ {font_path}")
    crop = canvas.crop(ink_box).convert("RGB")
    crop.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", required=True, help="字体文件（TTF/OTF）")
    parser.add_argument("--out", required=True, help="输出目录")
    parser.add_argument("--size", type=int, default=96, help="渲染字号（像素）")
    parser.add_argument("--texts", default="digits", choices=["digits", "labels", "both"])
    parser.add_argument("--stroke", type=int, default=0, help="描边宽度（匹配游戏加粗效果）")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    items = []
    if args.texts in ("digits", "both"):
        items += DIGITS
    if args.texts in ("labels", "both"):
        items += LABELS

    for name, text in items:
        render_text(args.font, text, args.size, os.path.join(args.out, f"{name}.png"), args.stroke)

    print(f"{os.path.basename(args.font)} -> {args.out}（{len(items)} 张，字号 {args.size}，描边 {args.stroke}）")


if __name__ == "__main__":
    main()