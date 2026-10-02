"""PIL 底层绘图工具：字体、圆角矩形、阴影、渐变、等比适配、多边形遮罩。

这里只放「怎么画」，不含任何 NIKKE 业务；版式在 :mod:`core.card` 里。

坐标约定
--------
所有对外接口都用**设计尺寸**（736×1096 的 CSS 像素）传坐标与字号，
内部统一乘 ``scale`` 落到实际像素上（默认 2x → 1472×2192）。
这样版式代码可以照着 ``characterCard.css`` 一行行对，不用到处乘缩放系数。
"""
from __future__ import annotations

import math
import threading

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from . import paths

# 逻辑字体名 → 文件名（文件由 bot/tools/build-fonts.mjs 生成）
FONT_FILES = {
    "cn": "NotoSansSC-Regular.otf",        # 一般中文
    "cn_black": "NotoSansSC-Black.otf",    # 装备词条区中文
    "num": "Industry-Demi.ttf",            # 一般数字/西文（DIN 风格，对应网页端 Bahnschrift）
    "digit": "Azonix-Regular.otf",         # 词条区数字与 %（对应网页端 Deco_ext_azx）
}

_FONT_LOCK = threading.Lock()
_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}
_COVERAGE: set[str] | None = None
_WARNED: set[str] = set()


def font(key: str, size: float) -> ImageFont.FreeTypeFont:
    """取指定逻辑字体的指定字号（像素）。结果缓存，重复调用无开销。"""
    pixel_size = max(1, int(round(size)))
    cached = _FONT_CACHE.get((key, pixel_size))
    if cached is not None:
        return cached
    name = FONT_FILES.get(key)
    if name is None:
        raise KeyError(f"未定义的字体：{key}")
    path = paths.FONT_DIR / name
    if not path.is_file():
        raise FileNotFoundError(f"字体缺失：{path}（跑 bot/tools/build-fonts.mjs 生成）")
    with _FONT_LOCK:
        cached = _FONT_CACHE.get((key, pixel_size))
        if cached is None:
            cached = ImageFont.truetype(str(path), pixel_size)
            _FONT_CACHE[(key, pixel_size)] = cached
    return cached


def _coverage() -> set[str]:
    """子集字体的字符集（由字体脚本生成），用于缺字告警。"""
    global _COVERAGE
    if _COVERAGE is None:
        import json

        chars: set[str] = set()
        try:
            raw = json.loads((paths.FONT_DIR / "coverage.json").read_text(encoding="utf-8"))
            for value in (raw.get("chars") or {}).values():
                chars |= set(value)
        except Exception:
            chars = set()
        _COVERAGE = chars
    return _COVERAGE


def check_coverage(text: str) -> list[str]:
    """返回 text 里子集字体可能没有的字形（去重）。

    缺字形时 PIL 不报错，只是画出来是空白/方块——出图看不出来就晚了，
    所以这里主动查一次并让调用方打日志。
    """
    known = _coverage()
    if not known:
        return []
    missing = sorted({ch for ch in str(text or "") if ch.strip() and ch not in known})
    if missing:
        key = "".join(missing)
        if key not in _WARNED:
            _WARNED.add(key)
    return missing


# ── 文本度量与排版 ───────────────────────────────────────────────────

def text_size(fnt: ImageFont.FreeTypeFont, text: str) -> tuple[int, int]:
    """文本的像素宽度与高度（用 getbbox，比 getsize 在 OTF 上更准）。"""
    if not text:
        return 0, 0
    left, top, right, bottom = fnt.getbbox(text)
    return right - left, bottom - top


def runs_width(runs: list[tuple[str, ImageFont.FreeTypeFont, tuple]]) -> int:
    return sum(text_size(fnt, text)[0] for text, fnt, _color in runs)


def draw_runs(draw: ImageDraw.ImageDraw, x: float, y: float, runs: list, align: str = "left") -> int:
    """把若干段不同字体/颜色的文本并排画出来（模拟内联混排）。

    runs: ``[(text, font, color), ...]``
    y 是**基线**位置，align 控制整体水平对齐（left / center / right），
    返回画完后的总宽度。
    """
    width = runs_width(runs)
    cursor = x
    if align == "center":
        cursor = x - width / 2
    elif align == "right":
        cursor = x - width
    for text, fnt, color in runs:
        if text:
            draw.text((cursor, y), text, font=fnt, fill=color, anchor="ls")
            cursor += text_size(fnt, text)[0]
    return width


# ── 形状 ─────────────────────────────────────────────────────────────

def rounded_mask(size: tuple[int, int], radius: float, supersample: int = 4) -> Image.Image:
    """圆角矩形遮罩（L 模式）。4 倍超采样再缩回来，边缘才不会有锯齿。"""
    width, height = size
    big = Image.new("L", (max(1, width * supersample), max(1, height * supersample)), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        (0, 0, big.width - 1, big.height - 1),
        radius=max(0, radius * supersample),
        fill=255,
    )
    return big.resize((width, height), Image.LANCZOS)


def hexagon_mask(size: tuple[int, int], supersample: int = 4) -> Image.Image:
    """六边形遮罩，对应 CSS ``clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)``。"""
    width, height = size
    big = (width * supersample, height * supersample)
    points = [
        (big[0] * 0.5, 0), (big[0], big[1] * 0.25), (big[0], big[1] * 0.75),
        (big[0] * 0.5, big[1]), (0, big[1] * 0.75), (0, big[1] * 0.25),
    ]
    mask = Image.new("L", big, 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return mask.resize((width, height), Image.LANCZOS)


def star_polygon(cx: float, cy: float, radius: float, points: int = 5, inner_ratio: float = 0.382) -> list:
    """五角星的顶点（尖朝上）。用多边形画星星，省得依赖字体里有 ★。"""
    coords = []
    for index in range(points * 2):
        r = radius if index % 2 == 0 else radius * inner_ratio
        angle = -math.pi / 2 + index * math.pi / points
        coords.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    return coords


# ── 图像处理 ─────────────────────────────────────────────────────────

def v_gradient(size: tuple[int, int], stops: list[tuple[float, tuple[int, int, int]]]) -> Image.Image:
    """竖直线性渐变。stops = [(位置 0~1, RGB), ...]，位置需递增。"""
    width, height = size
    image = Image.new("RGB", (1, height))
    pixels = image.load()
    for y in range(height):
        t = y / max(1, height - 1)
        color = stops[-1][1]
        for index in range(len(stops) - 1):
            left_pos, left_color = stops[index]
            right_pos, right_color = stops[index + 1]
            if left_pos <= t <= right_pos:
                span = right_pos - left_pos
                k = 0.0 if span <= 0 else (t - left_pos) / span
                color = tuple(round(left_color[i] + (right_color[i] - left_color[i]) * k) for i in range(3))
                break
        pixels[0, y] = color
    return image.resize((width, height), Image.BILINEAR)


def contain(image: Image.Image, box_w: float, box_h: float) -> Image.Image:
    """等比缩放到能放进 box（object-fit: contain）。"""
    if image.width <= 0 or image.height <= 0:
        return image
    ratio = min(box_w / image.width, box_h / image.height)
    size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
    return image.resize(size, Image.LANCZOS)


def cover(image: Image.Image, box_w: float, box_h: float) -> Image.Image:
    """等比缩放到铺满 box（object-fit: cover）。"""
    if image.width <= 0 or image.height <= 0:
        return image
    ratio = max(box_w / image.width, box_h / image.height)
    size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
    return image.resize(size, Image.LANCZOS)


def drop_shadow(layer: Image.Image, offset: tuple[float, float], blur: float,
                color: tuple[int, int, int], opacity: float) -> Image.Image:
    """由 alpha 生成投影层（CSS 的 drop-shadow 近似）。"""
    alpha = layer.getchannel("A")
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    tint = Image.new("RGBA", layer.size, (*color, round(255 * opacity)))
    shadow.paste(tint, (0, 0), alpha)
    if blur > 0:
        shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    if offset != (0, 0):
        shifted = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        shifted.paste(shadow, (round(offset[0]), round(offset[1])))
        shadow = shifted
    return shadow


def to_silhouette(image: Image.Image, color: tuple[int, int, int] = (0, 0, 0)) -> Image.Image:
    """把图像变成纯色剪影（对应 CSS ``filter: brightness(0) saturate(0)``），保留 alpha。"""
    tinted = Image.new("RGBA", image.size, (*color, 255))
    tinted.putalpha(image.getchannel("A"))
    return tinted


def fit_filters(image: Image.Image, saturation: float = 1.0, contrast: float = 1.0) -> Image.Image:
    """对应 CSS ``saturate() contrast()``。"""
    result = image
    if saturation != 1.0:
        result = ImageEnhance.Color(result).enhance(saturation)
    if contrast != 1.0:
        result = ImageEnhance.Contrast(result).enhance(contrast)
    return result


def clip_paste(canvas: Image.Image, image: Image.Image, position: tuple[int, int],
               clip: tuple[int, int, int, int] | None = None) -> None:
    """把 image 贴到 canvas 的 position，可选用 clip 矩形裁剪（对应 overflow: hidden）。"""
    if clip is None:
        canvas.alpha_composite(image, position)
        return
    left, top, right, bottom = clip
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.alpha_composite(image, position)
    mask = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(mask).rectangle((left, top, right - 1, bottom - 1), fill=255)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    canvas.alpha_composite(layer)


def paste_mask(canvas: Image.Image, color: tuple[int, int, int, int], mask: Image.Image,
               position: tuple[int, int]) -> None:
    """按遮罩铺一层纯色（画圆角/六边形底、描边都用它）。"""
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    solid = Image.new("RGBA", mask.size, color)
    solid.putalpha(mask)
    layer.alpha_composite(solid, position)
    canvas.alpha_composite(layer)


def crop_alpha_bbox(image: Image.Image) -> Image.Image:
    """裁掉四周全透明的空白。"""
    box = image.getchannel("A").getbbox()
    return image.crop(box) if box else image


# ── 设计尺寸画笔 ─────────────────────────────────────────────────────

class Painter:
    """按**设计尺寸**写坐标，内部统一乘 scale。

    出图的版式都写在设计尺寸上（角色卡 736×1096、表格按内容排），
    这样版式代码可以照着 CSS 一行行对，不用到处乘缩放系数。
    """

    def __init__(self, scale: float, width: float, height: float):
        self.s = float(scale)
        self.w = float(width)
        self.h = float(height)
        self.canvas = Image.new("RGBA", (self.px(width), self.px(height)), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.canvas)

    # 坐标换算
    def px(self, value: float) -> int:
        return int(round(value * self.s))

    def size(self, w: float, h: float) -> tuple[int, int]:
        return max(1, self.px(w)), max(1, self.px(h))

    def box(self, x: float, y: float, w: float, h: float) -> tuple[int, int, int, int]:
        return self.px(x), self.px(y), self.px(x + w) - 1, self.px(y + h) - 1

    def font(self, key: str, size: float) -> ImageFont.FreeTypeFont:
        return font(key, size * self.s)

    # 底色与投影
    def panel(self, x, y, w, h, radius=0.0, fill=None, shadow=None, outline=None, width=1.0):
        """矩形/圆角块；shadow = (dx, dy, blur, rgb, opacity)，对应 CSS box-shadow。"""
        if shadow is not None:
            dx, dy, blur, color, opacity = shadow
            mask = rounded_mask(self.size(w, h), radius * self.s)
            layer = Image.new("RGBA", self.size(w, h), (0, 0, 0, 0))
            layer.paste(Image.new("RGBA", layer.size, (*color, round(255 * opacity))), (0, 0), mask)
            if blur > 0:
                layer = layer.filter(ImageFilter.GaussianBlur(blur * self.s))
            self.canvas.alpha_composite(layer, (self.px(x) + round(dx * self.s), self.px(y) + round(dy * self.s)))
        if fill is not None or outline is not None:
            self.draw.rounded_rectangle(
                self.box(x, y, w, h),
                radius=self.px(radius),
                fill=fill,
                outline=outline,
                width=max(1, round(width * self.s)),
            )

    def image(self, source: Image.Image, x, y, w, h, fit="contain", align="center", clip=None,
              silhouette=False, shadow=None):
        """贴图。x/y/w/h 是设计单位的目标框；align 控制 contain 时的对齐。"""
        if source is None:
            return
        image = to_silhouette(source) if silhouette else source
        target_w, target_h = self.size(w, h)
        scaled = cover(image, target_w, target_h) if fit == "cover" else contain(image, target_w, target_h)
        if align == "top-center":
            dx = self.px(x) + (target_w - scaled.width) // 2
            dy = self.px(y)
        elif align == "bottom-center":
            dx = self.px(x) + (target_w - scaled.width) // 2
            dy = self.px(y + h) - scaled.height
        elif align == "bottom-left":
            dx, dy = self.px(x), self.px(y + h) - scaled.height
        else:
            dx = self.px(x) + (target_w - scaled.width) // 2
            dy = self.px(y) + (target_h - scaled.height) // 2
        if shadow is not None:
            dxs, dys, blur, color, opacity = shadow
            ghost = drop_shadow(scaled, (dxs * self.s, dys * self.s), blur * self.s, color, opacity)
            self.canvas.alpha_composite(ghost, (dx, dy))
        clip_paste(self.canvas, scaled, (dx, dy), clip)

    def decoration(self, name: str, x, y, w, h, shadow=None):
        """装饰帧（``ui-assets/nikke/metadata/decorations/<name>.png``）。"""
        self.image(load_asset(f"ui-assets/nikke/metadata/decorations/{name}.png"), x, y, w, h, shadow=shadow)


_IMAGE_CACHE: dict[str, Image.Image | None] = {}
_MISSING_ASSETS: set[str] = set()


def load_asset(relative: str) -> Image.Image | None:
    """按素材相对路径读图（带缓存）。读不到返回 None 并记下来（出图缺料要能查）。"""
    if not relative:
        return None
    if relative in _IMAGE_CACHE:
        return _IMAGE_CACHE[relative]
    image: Image.Image | None = None
    try:
        image = Image.open(paths.asset(relative)).convert("RGBA")
    except Exception:
        image = None
        _MISSING_ASSETS.add(relative)
    _IMAGE_CACHE[relative] = image
    return image


def missing_assets() -> list[str]:
    """本次进程里读不到的素材相对路径（自检/预览用）。"""
    return sorted(_MISSING_ASSETS)
