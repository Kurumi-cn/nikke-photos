#!/bin/bash
# 在服务器上把 /tmp/nikke_deploy/<plugin> 装进 AstrBot 插件目录，并可选重载容器。
#
# 用法（在服务器上执行）：
#   bash remote-install.sh <plugin_name> [restart|norestart]
#
# 注意：这里是**覆盖合并**（cp -r src/. dst/），不是删除重建 ——
# 插件目录里的 assets/ 有一百多兆素材，重建意味着每次都要重传。
# 代价是本地删掉的文件不会从服务器上消失，需要时手动清理。
set -eu

PLUGIN="${1:?用法: bash remote-install.sh <plugin_name> [restart|norestart]}"
MODE="${2:-restart}"
TARGET="/home/ubuntu/astrbot/data/plugins/$PLUGIN"
SRC="/tmp/nikke_deploy/$PLUGIN"

if [ ! -d "$SRC" ]; then
  echo "源码目录不存在：$SRC" >&2
  exit 1
fi

sudo -n mkdir -p "$TARGET"
sudo -n cp -r "$SRC"/. "$TARGET"/
sudo -n chown -R ubuntu:ubuntu "$TARGET"
# scp 过来的目录会带 750（umask 027），容器里若不是 root 跑就读不了，
# 统一放宽到「目录可进入、文件可读」，符合素材只读的定位
sudo -n chmod -R a+rX "$TARGET"
echo "installed -> $TARGET"
ls -la "$TARGET"

if [ "$MODE" = "restart" ]; then
  # 先在容器里编译一遍：语法错误能在重载前看见，省得重启完才发现插件没加载
  sudo -n docker exec astrbot python -m compileall -q "/AstrBot/data/plugins/$PLUGIN" \
    && echo "compile OK"
  sudo -n docker restart astrbot
  echo "astrbot restarted"
fi
