"""NIKKE练度统计助手的内部模块。

分层与参考插件（astrbot_plugin_astral_party）一致：
  · main.py        只做「注册指令 → 取参数 → 调 core → 把结果发出去」
  · core/paths.py  路径解析（素材目录 / 用户数据目录）
  · core/roster.py 角色索引与名字解析
  · core/texts.py  所有面向用户的文案（单一事实源）

后续接入的模块（分享码、按 QQ 存档、PIL 出图）同样落在 core/ 下，
main.py 不直接碰协议与绘图细节。
"""
