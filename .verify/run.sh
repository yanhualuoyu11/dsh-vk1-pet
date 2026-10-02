#!/bin/sh
# 把当前 checkout 作为插件挂进一个 DSH web，用独立 DSH_HOME，不碰你真实的 ~/.dsh。
#
#   .verify/run.sh                          # http://127.0.0.1:3099
#   VK1_PORT=3100 .verify/run.sh
#   DEEPSEEK_API_KEY=sk-... .verify/run.sh  # 想验证真实余额时把密钥放进环境变量
#
# 没有 DEEPSEEK_API_KEY 也照常启动：插件会走「未配置凭证」分支，显示抱盆图。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERIFY="$ROOT/.verify"
# 刻意不读继承来的 DSH_HOME：本会话的 DSH_HOME 指向真实 home，
# 用它会让脚手架写到真实配置里去。要换目录请用 VK1_DSH_HOME。
export DSH_HOME="${VK1_DSH_HOME:-$VERIFY/dsh-home}"

# 插件行要求绝对路径，所以在运行时生成 patch，而不是把某个人的目录提交进仓库。
cat > "$VERIFY/plugin.patch.yml" <<YAML
# 由 .verify/run.sh 生成，指向当前 checkout。
- insert:
    - id: dsh-vk1-pet
      name: '$ROOT/dsh-vk1-pet/host/index.js'
YAML

cd "$ROOT"
exec dsh --profile web --patch "$VERIFY/plugin.patch.yml" --port "${VK1_PORT:-3099}" --no-open
