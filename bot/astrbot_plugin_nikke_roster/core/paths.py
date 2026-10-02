"""路径解析：素材目录（随插件走，只读）与用户数据目录（随容器持久化，可手改）。

约定
----
``assets/``
    随插件包一起部署，只读。素材**沿用网页端 ``app/public/`` 的相对路径**
    （``avatars/xxx.png``、``icons/属性/燃烧.webp``、``ui-assets/nikke/...``），
    这样 roster.json 里记录的路径字符串拼上 assets 根目录就能直接用，
    两边不需要各维护一张映射表。

用户数据目录
    ``StarTools.get_data_dir(PLUGIN_NAME)`` —— 容器里是
    ``data/plugin_data/astrbot_plugin_nikke_roster/``。别名表和按 QQ 的练度
    存档都写在这里，用户可以用 FinalShell 直接打开编辑。
    取不到时退回插件目录下的 ``data/``，再退回模块同级，保证任何加载方式都能写。
"""
from __future__ import annotations

from pathlib import Path

PLUGIN_NAME = "astrbot_plugin_nikke_roster"

# 插件根目录（core/paths.py → core/ → 插件根）
PLUGIN_DIR = Path(__file__).resolve().parent.parent

ASSETS_DIR = PLUGIN_DIR / "assets"

# 角色表（由网页端 app/src/data/roster.json 整份拷贝而来，见 README 的「素材同步」）
ROSTER_FILE = ASSETS_DIR / "data" / "roster.json"

# 出图用的字体（Noto Sans SC 子集 + Industry + Azonix）
FONT_DIR = ASSETS_DIR / "fonts"

#: 备用素材根目录。默认不启用：素材（立绘/头像/图标）只部署在服务器上，
#: 本地源码树里没有那 104MB。本地预览出图时把它指到网页端的 app/public，
#: 两边相对路径完全一致，就不用为了看图把素材再拷一份。
FALLBACK_ASSETS_DIR: Path | None = None


def asset(relative: str) -> Path:
    """把 roster.json 里的相对路径（如 ``ui-assets/nikke/cubes/ie_10001.png``）
    解析成素材的绝对路径；主目录没有时退到 FALLBACK_ASSETS_DIR。"""
    relative = str(relative).lstrip("/\\")
    primary = ASSETS_DIR / relative
    if FALLBACK_ASSETS_DIR is not None and not primary.is_file():
        fallback = FALLBACK_ASSETS_DIR / relative
        if fallback.is_file():
            return fallback
    return primary


def asset_exists(relative: str) -> bool:
    try:
        return asset(relative).is_file()
    except Exception:
        return False


def user_data_dir() -> Path:
    """可写的用户数据目录（别名表、练度存档、出图缓存都放这里）。"""
    try:
        from astrbot.api.star import StarTools  # type: ignore

        d = Path(StarTools.get_data_dir(PLUGIN_NAME))
        d.mkdir(parents=True, exist_ok=True)
        return d
    except Exception:
        pass
    for fallback in (PLUGIN_DIR / "data", PLUGIN_DIR):
        try:
            fallback.mkdir(parents=True, exist_ok=True)
            return fallback
        except Exception:
            continue
    return PLUGIN_DIR


def aliases_path() -> Path:
    """别名表路径。这是**用户手改**的文件，每次用都要重新读盘，不要缓存。"""
    return user_data_dir() / "aliases.json"


def users_dir() -> Path:
    """按 QQ 的练度存档目录（一个 QQ 一个 JSON，见 ``core/store.py``）。"""
    d = user_data_dir() / "users"
    d.mkdir(parents=True, exist_ok=True)
    return d
