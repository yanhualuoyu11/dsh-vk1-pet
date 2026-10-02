#!/bin/sh
# 第二种验证：插件是**按用户的方式装进 profile** 的
# （`dsh plugin --profile vk1bundle add ./dsh-vk1-pet -w`），
# 所以模块解析走 profile 自己的 node_modules 链接，而不是 --patch 的直接路径。
#
#   .verify/run-installed.sh                 # http://127.0.0.1:3098
#   DEEPSEEK_API_KEY=sk-... .verify/run-installed.sh
#
# 首次使用前先建好 profile（见 .verify/README.md），脚本会在缺 profile 时提示。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERIFY="$ROOT/.verify"
PROFILE="${VK1_PROFILE:-vk1bundle}"

# 刻意不读继承来的 DSH_HOME，理由见 run.sh。要换目录请用 VK1_DSH_HOME。
export DSH_HOME="${VK1_DSH_HOME:-$VERIFY/dsh-home}"
export XDG_DATA_HOME="$VERIFY/xdg-data" XDG_CACHE_HOME="$VERIFY/xdg-cache" XDG_CONFIG_HOME="$VERIFY/xdg-config"
export npm_config_store_dir="$VERIFY/pnpm-store"

if [ ! -f "$DSH_HOME/profiles/$PROFILE/package.json" ]; then
  echo "还没有 profile '$PROFILE'。先运行：" >&2
  echo "  DSH_HOME=$DSH_HOME dsh --profile $PROFILE --from-default-profile web --help" >&2
  echo "  DSH_HOME=$DSH_HOME dsh plugin --profile $PROFILE add ./dsh-vk1-pet -w" >&2
  exit 1
fi

cd "$ROOT"
exec dsh --profile "$PROFILE" --port "${VK1_PORT:-3098}" --no-open
