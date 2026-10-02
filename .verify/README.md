# 验证脚手架

这里的脚本用来**在不碰你真实 `~/.dsh`** 的前提下，把插件真的跑起来验证一遍：
`DSH_HOME` 指向仓库内的 `.verify/dsh-home`。

两个刻意的约束：

- 脚本**不读**继承来的 `DSH_HOME`——很多 shell 里它已经指向真实 home，用它会让脚手架
  写到真实配置里去。要换目录请用 `VK1_DSH_HOME`。
- 脚本**不猜** `dsh` 和 `node` 的位置，直接用 `PATH` 上的那个。所以先确认
  `dsh --version` 在同一个 shell 里能跑通。

插件每一行的路径都要求绝对路径，所以 `plugin.patch.yml` 由 `run.sh` 在运行时生成
（已被 `.gitignore` 忽略），仓库里不留任何人的目录。

## 1. 用 `--patch` 直接挂载 checkout（最快）

```sh
.verify/run.sh                          # http://127.0.0.1:3099
DEEPSEEK_API_KEY=sk-... .verify/run.sh  # 想验证真实余额
```

插件通过运行时生成的 `.verify/plugin.patch.yml`（绝对路径）挂载，不需要安装。
不带密钥也能跑：插件会走「未配置凭证」分支，正好用来验证抱盆图。

## 2. 验证「用户安装后的样子」

```sh
export DSH_HOME=$PWD/.verify/dsh-home
export XDG_DATA_HOME=$PWD/.verify/xdg-data XDG_CACHE_HOME=$PWD/.verify/xdg-cache
export npm_config_store_dir=$PWD/.verify/pnpm-store

dsh --profile vk1bundle --from-default-profile web --help
dsh plugin --profile vk1bundle add ./dsh-vk1-pet -w
dsh --profile vk1bundle --dump-config | grep -A2 'dsh-vk1-pet'

.verify/run-installed.sh                # http://127.0.0.1:3098
```

这一轮验证的是模块解析走 profile 自己的 `node_modules` 链接，而不是 `--patch` 的直连路径。

## 3. 用 Cookie 访问插件路由

`dsh web` 启动时会打印带 `?token=` 的地址；用它换一次 Cookie，之后就能像浏览器一样访问：

```sh
TOKEN=<启动日志里的 token>
curl -c cookies.txt "http://127.0.0.1:3099/?token=$TOKEN"
curl -b cookies.txt "http://127.0.0.1:3099/dsh-vk1-pet/api/state"
curl -b cookies.txt -X POST -d '{}' "http://127.0.0.1:3099/dsh-vk1-pet/api/refresh"
curl -b cookies.txt -o /dev/null -w '%{http_code}\n' \
     "http://127.0.0.1:3099/dsh-vk1-pet/assets/sprite.png"
```

应当看到：不带 Cookie 得到 `401`；带 Cookie 的 `assets/../package.json` 得到 `404`；
`api/state` 返回 `{ ok: true, state: { … } }`。

## 4. 离屏预览图

用插件自己的几何常量渲染，不是另写一份：

```sh
pip install --target .verify/pylibs pillow
curl -sSL -o .verify/fonts/NotoSansSC-Bold.otf \
  https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf

node .verify/preview-geometry.mjs > .verify/geometry.json
PYTHONPATH=.verify/pylibs python3 .verify/render_preview.py
```

产物在 `.verify/previews/`，其中 `contact-sheet.png` 是七个场景的横排总览；
仓库里的 `docs/previews/` 是它的副本。

## 目录里什么是生成的

`.verify/plugin.patch.yml`、`dsh-home/`、`xdg-*/`、`pnpm-store/`、`pylibs/`、
`fonts/`、`geometry.json`、`previews/`、`cookies*.txt` 都是生成的，删掉后按上面
步骤可以完全重建。源文件只有 `run.sh`、`run-installed.sh`、`preview-geometry.mjs`、
`render_preview.py` 和这份说明。
