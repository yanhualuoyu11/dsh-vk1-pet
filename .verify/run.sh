#!/bin/sh
# Verification launcher: boot a DSH web profile that lives entirely inside this
# workspace, with the plugin mounted from the checkout by absolute path.
#
# DSH_HOME is redirected so nothing here touches the user's real ~/.dsh, and the
# API key is read from the real credential store into the environment without
# ever being echoed.
set -eu
export PATH=/root/.nvm/versions/node/v22.22.2/bin:$PATH
export DSH_HOME=/root/projs/ds_VK-1_plugin/.verify/dsh-home
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
exec dsh --profile web --patch /root/projs/ds_VK-1_plugin/.verify/plugin.patch.yml --port "${VK1_PORT:-3099}" --no-open
