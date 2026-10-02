"""日志入口。

优先用 AstrBot 的 logger（插件跑在框架里时，日志会带上插件名前缀）；
取不到就用标准库 —— 这样 core 下的模块能在容器外单独跑（本地预览出图、
协议跨语言核对都依赖这一点，否则 import 阶段就会因为缺 astrbot 包而失败）。
"""
from __future__ import annotations

import logging as _logging

try:  # pragma: no cover - 取决于运行环境
    from astrbot.api import logger  # type: ignore
except Exception:  # pragma: no cover
    logger = _logging.getLogger("astrbot_plugin_nikke_roster")
    if not logger.handlers:
        _handler = _logging.StreamHandler()
        _handler.setFormatter(_logging.Formatter("%(levelname)s %(message)s"))
        logger.addHandler(_handler)
        logger.setLevel(_logging.INFO)
