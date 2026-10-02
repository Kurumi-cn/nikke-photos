#!/bin/bash
# 把种子文件放进插件的用户数据目录（data/plugin_data/<plugin>/）。
#
# 默认**不覆盖**已存在的文件 —— 服务器上那份是用户用 FinalShell 手改的，
# 拿种子盖掉等于把人家的活干掉。确实要重置时才加 force。
#
# 用法：bash remote-seed.sh <种子目录> [force]
set -eu

SRC="${1:?用法: bash remote-seed.sh <种子目录> [force]}"
FORCE="${2:-no}"
PLUGIN=astrbot_plugin_nikke_roster
DEST="/home/ubuntu/astrbot/data/plugin_data/$PLUGIN"

sudo -n mkdir -p "$DEST"
sudo -n chown ubuntu:ubuntu "$DEST"

for f in "$SRC"/*.json; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  if [ -e "$DEST/$name" ] && [ "$FORCE" != "force" ]; then
    echo "skip   $name（服务器上已有，未覆盖）"
    continue
  fi
  cp "$f" "$DEST/$name"
  echo "placed $name"
done

sudo -n chown -R ubuntu:ubuntu "$DEST"
# 用户手改的文件要能读能写；素材式的只读放宽到 a+rX 就够
sudo -n chmod -R u+rwX,go+rX "$DEST"
echo "--- $DEST ---"
ls -la "$DEST"
