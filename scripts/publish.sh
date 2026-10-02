#!/usr/bin/env bash
#
# 创建 GitHub 仓库并推送这个项目。
#
#   scripts/publish.sh                    # 用 gh CLI 的登录态
#   GITHUB_TOKEN=ghp_xxx scripts/publish.sh
#   scripts/publish.sh my-repo-name       # 换个仓库名（默认 dsh-vk1-pet）
#
# 令牌只从环境变量或 gh CLI 读，不会写进仓库、不会写进 git config。
# 一切就绪后脚本只做三件事：commit（如果还没提交）、建仓库（如果还不存在）、push。
set -euo pipefail

REPO_NAME="${1:-dsh-vk1-pet}"
BRANCH="main"
REPO_DESCRIPTION="DSH 余额桌宠：把 VK-1 做成 DeepSeek Harness 的 web 插件"

cd "$(dirname "$0")/.."

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. 提交身份 ───────────────────────────────────────────────────────────────
# 提交作者必须是你自己：本脚本不写 --author，也不改 git config。
if [ -z "$(git config user.name || true)" ] || [ -z "$(git config user.email || true)" ]; then
  die "git 还没有提交身份。先设置（只设一次，全局生效）：
    git config --global user.name  \"你的名字\"
    git config --global user.email \"你的邮箱\"
  想只对本仓库生效就去掉 --global。"
fi

# ── 2. 首次提交 ───────────────────────────────────────────────────────────────
if ! git rev-parse --verify -q HEAD >/dev/null; then
  say "创建首次提交……"
  git add -A
  git commit -q -m "$(cat <<'MSG'
DSH 余额桌宠：把 VK-1 做成 DSH web 插件

宿主半边用 DSH 自己的凭证服务与账号服务读余额并通过 /dsh-vk1-pet/api/*
暴露只读投影；浏览器半边注册进 shell.overlay，在网页界面上渲染悬浮桌宠
（四个角色、拖拽吸附、扣费红闪/震动/原版音效、充值绿环、离线抱盆图、
平板余额、逐像素鼠标穿透）。

- host/   无构建、无运行时依赖的 cordis 插件
- client/ index.jsx 由 esbuild 构建为已提交的 client.js
- assets/ 五张角色 PNG 与 hit.mp3，逐字节复制自上游并记录 SHA-256
- test/   62 个用例，含 jsdom 真实 DOM 渲染层
MSG
)"
else
  if [ -n "$(git status --porcelain)" ]; then
    say "工作区有未提交的改动，先提交它们……"
    git add -A
    git commit -q -m "更新"
  fi
fi
[ -z "$(git status --porcelain)" ] || die "工作区仍不干净，请先处理：git status"
git rev-parse --verify -q HEAD >/dev/null || die "没有任何提交，无法推送。"

# ── 3. 确认远端 ───────────────────────────────────────────────────────────────
if git remote get-url origin >/dev/null 2>&1; then
  say "已存在 origin：$(git remote get-url origin)"
  git push -u origin "$BRANCH"
  say "完成。"
  exit 0
fi

# ── 4. 建仓库 ─────────────────────────────────────────────────────────────────
if [ -n "${GITHUB_TOKEN:-}" ]; then
  api() { curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
                 -H "Accept: application/vnd.github+json" \
                 -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }

  LOGIN="$(api https://api.github.com/user | sed -n 's/.*"login"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "$LOGIN" ] || die "令牌无效或权限不足（拿不到 /user）。"
  say "以 $LOGIN 的身份创建仓库 ${LOGIN}/${REPO_NAME} ……"

  if api "https://api.github.com/repos/${LOGIN}/${REPO_NAME}" >/dev/null 2>&1; then
    say "仓库已存在，直接推送。"
  else
    api -X POST https://api.github.com/user/repos \
      -d "$(printf '{"name":"%s","description":"%s","private":false,"auto_init":false}' "$REPO_NAME" "$REPO_DESCRIPTION")" \
      >/dev/null
  fi

  git remote add origin "https://github.com/${LOGIN}/${REPO_NAME}.git"
  # 令牌只在这一条命令的环境里出现，不落到 .git/config。
  git -c "http.https://github.com/.extraheader=Authorization: Bearer ${GITHUB_TOKEN}" \
      push -u origin "$BRANCH"
  git remote set-url origin "https://github.com/${LOGIN}/${REPO_NAME}.git"
  say "完成：https://github.com/${LOGIN}/${REPO_NAME}"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  say "用 gh CLI 创建仓库并推送……"
  gh repo create "$REPO_NAME" --public --source=. --remote=origin \
     --description "$REPO_DESCRIPTION" --push
  say "完成。"
else
  cat <<EOF
没有可用的 GitHub 凭证。二选一：

A. 安装并登录 gh CLI，然后重跑本脚本：
     gh auth login
     scripts/publish.sh

B. 在网页上建空仓库（不要勾选 README / .gitignore / license），然后：
     git remote add origin https://github.com/<你的用户名>/${REPO_NAME}.git
     git push -u origin ${BRANCH}

C. 用令牌跑：
     GITHUB_TOKEN=<fine-grained PAT，需 Contents: read/write 与 Administration: write> scripts/publish.sh
EOF
  exit 1
fi
