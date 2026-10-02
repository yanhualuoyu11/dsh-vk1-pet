# 验证脚手架

这里的脚本用来**在不碰你正在用的 `dsh web`** 的前提下，把插件真的跑起来验证一遍。
关键在于 `DSH_HOME` 被指向工作区内的 `.verify/dsh-home`，所以 `~/.dsh` 从头到尾只被读取
（读一次真实 API Key），没有被写入。

## 一次性准备

```sh
cd /root/projs/ds_VK-1_plugin

# 渲染预览图需要 Pillow（装进工作区，不动系统 Python）
pip install --target .verify/pylibs pillow
# 预览里的中文标题需要一个 CJK 字体
curl -sSL -o .verify/fonts/NotoSansSC-Bold.otf \
  https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf
```

`.verify/pylibs` 是用 python3.12 装的；渲染时请用 `python3.12`。

## 1. 用 --patch 直接挂载 checkout（最快）

```sh
.verify/run.sh            # http://127.0.0.1:3099
```

插件通过 `plugin.patch.yml` 里的绝对路径挂载，不需要安装，改完代码重启即可。

## 2. 用 dsh plugin add 安装后的 profile

```sh
export DSH_HOME=$PWD/.verify/dsh-home
export XDG_DATA_HOME=$PWD/.verify/xdg-data XDG_CACHE_HOME=$PWD/.verify/xdg-cache
export npm_config_store_dir=$PWD/.verify/pnpm-store

dsh --profile vk1bundle --from-default-profile web --help
dsh plugin --profile vk1bundle add ./dsh-vk1-pet -w
dsh --profile vk1bundle --dump-config | grep -A2 'dsh-vk1-pet'

.verify/run-installed.sh  # http://127.0.0.1:3098
```

## 3. 取 Cookie 后访问路由

`dsh web` 启动时会打印带 `?token=` 的地址；用它换一次 Cookie，之后就能像浏览器一样访问：

```sh
TOKEN=<启动日志里的 token>
curl -c cookies.txt "http://127.0.0.1:3098/?token=$TOKEN"
curl -b cookies.txt "http://127.0.0.1:3098/dsh-vk1-pet/api/state"
curl -b cookies.txt -X POST -d '{}' "http://127.0.0.1:3098/dsh-vk1-pet/api/refresh"
curl -b cookies.txt -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3098/dsh-vk1-pet/assets/sprite.png"
```

不带 Cookie 请求应当得到 `401`；带 Cookie 的 `assets/../package.json` 应当得到 `404`。

## 4. 未配置凭证的分支

```sh
DSH_HOME=$PWD/.verify/dsh-home dsh --profile vk1bundle --port 3097 --no-open
```

（不设置 `DEEPSEEK_API_KEY`）状态应为 `unconfigured`，浏览器据此显示抱盆图。

## 5. 离屏预览图

用插件自己的几何常量渲染，不是另写一份：

```sh
node .verify/preview-geometry.mjs > .verify/geometry.json
PYTHONPATH=.verify/pylibs python3.12 .verify/render_preview.py
```

产物在 `.verify/previews/`，其中 `contact-sheet.png` 是七个场景的横排总览，
仓库的 `docs/previews/` 是它的副本。

## 目录里什么是生成的

`dsh-home/`、`xdg-*/`、`pnpm-store/`、`pylibs/`、`fonts/`、`geometry.json`、
`previews/`、`cookies*.txt`、`index*.html`、`bundle*.js` 都是生成的，删掉后按上面的
步骤可以完全重建；只有 `run.sh`、`run-installed.sh`、`plugin.patch.yml`、
`preview-geometry.mjs`、`render_preview.py` 是源文件。
