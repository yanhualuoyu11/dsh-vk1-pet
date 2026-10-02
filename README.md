# VK-1 → DSH 插件

~~Deepseek大制作~~

把 [VKmich16/VK-1](https://github.com/VKmich16/VK-1)（「DSH 余额桌宠」，原本是独立的
macOS Swift 应用 / Windows PowerShell 脚本）改造成 **DeepSeek Harness 的 web 插件**。

![桌宠总览](docs/previews/contact-sheet.png)


## 成果

| | |
| --- | --- |
| 插件包 | [`dsh-vk1-pet/`](dsh-vk1-pet) —— 可直接 `dsh plugin add` 的 bundle |
| 宿主半边 | 读凭证、轮询余额、暴露 `/dsh-vk1-pet/api/*` 与 `/dsh-vk1-pet/assets/*` |
| 浏览器半边 | 注册进 `shell.overlay` 的悬浮桌宠：四角色、拖拽吸附、扣费红闪/震动/原版音效、充值绿环、离线抱盆图、余额平板 |
| 验证 | 62 个自动化用例 + 独立 profile 端到端启动验证（不影响你正在用的 `dsh web`） |

详细说明见 [`dsh-vk1-pet/README.md`](dsh-vk1-pet/README.md)。

## 快速安装

```sh
cd /root/projs/ds_VK-1_plugin
dsh plugin --profile web add ./dsh-vk1-pet -w
dsh web            # 重启后生效
```

打开界面，桌宠出现在左下角，余额胶囊在它上方。右键桌宠或点胶囊打开菜单。

卸载：`dsh plugin --profile web remove dsh-vk1-pet`。


## 目录

```
.
├── dsh-vk1-pet/            插件包（交付物）
│   ├── host/               宿主半边，手写 ESM，无构建、无运行时依赖
│   ├── client/             浏览器半边（index.jsx → 构建为 client/client.js，产物已提交）
│   ├── assets/             5 张角色 PNG + hit.mp3，逐字节复制自上游
│   └── test/               62 个用例
├── docs/previews/          离线渲染的效果预览（由 .verify 生成）
├── scripts/publish.sh      建仓库 + 推送的一键脚本（见下）
├── .verify/                可复现的验证脚手架：独立 DSH_HOME、验证脚本、预览渲染器
└── repo/                   本地参考：上游 VK-1 的源码快照，**不入库**（见 .gitignore）
```

`repo/` 只是移植时用来比对素材的第三方 checkout（上游未附许可证），已写进 `.gitignore`。
插件真正分发的 5 张图与 `hit.mp3` 都在 `dsh-vk1-pet/assets/`，并逐文件记录了 SHA-256。

## 来源与许可

插件代码 MIT，见 [`dsh-vk1-pet/LICENSE`](dsh-vk1-pet/LICENSE)。角色图片与 `hit.mp3`
来自上游 VK-1（上游未附许可证），本仓库只做逐字节复制并保留来源说明与 SHA-256，
不额外授权，详见 [`dsh-vk1-pet/assets/README.md`](dsh-vk1-pet/assets/README.md)。
