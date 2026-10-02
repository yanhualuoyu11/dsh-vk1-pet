#!/bin/sh
# Verification launcher #2: boot the profile where the plugin is installed the
# way a user installs it (`dsh plugin --profile vk1bundle add …`), so module
# resolution goes through the profile's own node_modules symlink.
set -eu
export PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH
V=/root/projs/ds_VK-1_plugin/.verify
export DSH_HOME=$V/dsh-home
export XDG_DATA_HOME=$V/xdg-data XDG_CACHE_HOME=$V/xdg-cache XDG_CONFIG_HOME=$V/xdg-config
export npm_config_store_dir=$V/pnpm-store
export DEEPSEEK_API_KEY="$(python3 - <<'PY'
import re
try:
    txt = open('/root/.dsh/.credentials.yaml', encoding='utf-8').read()
except OSError:
    print('')
    raise SystemExit
m = re.search(r'^\s*DEEPSEEK_API_KEY:\s*(\S+)\s*$', txt, re.M)
print(m.group(1).strip().strip('"\'') if m else '')
PY
)"
cd /root/projs/ds_VK-1_plugin
exec dsh --profile vk1bundle --port "${VK1_PORT:-3098}" --no-open
