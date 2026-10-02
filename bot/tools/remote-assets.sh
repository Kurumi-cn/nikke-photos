#!/bin/bash
# 把 /tmp/nikke-assets.tar 解开到插件的 assets 目录。
#
# 素材沿用网页端 app/public/ 的相对路径（avatars/…、icons/…、ui-assets/nikke/…），
# 这样 roster.json 里记录的路径字符串可以直接拼出来用，两边不用各维护一张映射表。
# ocr/ 不需要（那是网页端图像识别的模板，BOT 不出识别结果）。
set -eu

PLUGIN="${1:-astrbot_plugin_nikke_roster}"
TARGET="/home/ubuntu/astrbot/data/plugins/$PLUGIN/assets"
TARBALL="/tmp/nikke-assets.tar"

if [ ! -f "$TARBALL" ]; then
  echo "找不到 $TARBALL" >&2
  exit 1
fi

mkdir -p "$TARGET"
sudo -n tar -xf "$TARBALL" -C "$TARGET"
sudo -n chown -R ubuntu:ubuntu "$TARGET"
# 素材是只读资源：目录可进入、文件可读即可
sudo -n chmod -R a+rX "$TARGET"

echo "--- $TARGET ---"
ls -la "$TARGET"
echo "--- 文件数 ---"
for d in avatars icons ui-assets; do
  printf '%-12s %s\n' "$d" "$(find "$TARGET/$d" -type f 2>/dev/null | wc -l)"
done
echo "总计 $(find "$TARGET" -type f | wc -l) 个文件"
