#!/bin/bash
# 检查插件在服务器上的落地情况：容器里能不能看到、有没有加载、最近日志说了什么。
#
# 用法：bash remote-check.sh [plugin_name]
set -u

PLUGIN="${1:-astrbot_plugin_nikke_roster}"
HOST_DIR="/home/ubuntu/astrbot/data/plugins/$PLUGIN"
CONT_DIR="/AstrBot/data/plugins/$PLUGIN"

echo "=== 宿主机插件目录 ==="
ls -la "$HOST_DIR" 2>&1

echo
echo "=== 容器内是否可见 ==="
sudo -n docker exec astrbot ls -la "$CONT_DIR" 2>&1

echo
echo "=== 容器状态 ==="
sudo -n docker ps --filter name=astrbot --format '{{.Status}}'

echo
echo "=== 最近日志中与本插件相关的行 ==="
sudo -n docker logs --tail 800 astrbot 2>&1 \
  | grep -i -E 'nikke|roster|NIKKE练度' | tail -40
echo "（以上为空 = 日志里还没出现插件名）"

echo
echo "=== 日志末尾 25 行（看有没有加载报错）==="
sudo -n docker logs --tail 25 astrbot 2>&1
