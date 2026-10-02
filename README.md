# dsh-vk1-pet · DSH 余额桌宠

~~Deepseek大制作~~

> 把 [VK-1](https://github.com/VKmich16/VK-1) 这只桌面宠物，做成 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
> 的 web 插件：不装独立应用、不开额外窗口，桌宠直接悬浮在 DSH 网页界面上，
> 余额显示在她手持的那块倾斜平板上。

![桌宠总览](docs/previews/contact-sheet.png)

从左到右：连接中（蓝色大肥鱼 · 中号）、扣费瞬间（红闪 + `-0.01` 飘字 + 震动）、充值（绿环）、
未连接（抱盆图）、北美猫娘 Gemini（大号，文字区避开手指）、GPT龙娘（特大，长金额自动缩小）、
大小姐 Claude（小号）。

## 这是什么

原版 VK-1 是一个独立的 macOS Swift 应用（更早还有 Windows PowerShell 版）：自己读凭证文件、
自己开一个无边框窗口、自己轮询余额。

作为 DSH 插件，这些职责回到 DSH 本身：**宿主半边**用 DSH 自己的凭证服务与账号服务拿余额，
**浏览器半边**只负责把那只鱼画出来。所以它是**一个包、零独立进程、跨平台**——
macOS、Windows、Linux 上跑的都是同一份代码，因为它跑在浏览器里。

## 功能

| 功能 | 说明 |
| --- | --- |
| 余额平板 | 余额、`¥` 符号与连接状态点一起绘制在角色手持的倾斜平板上，跟随震动 |
| 四个角色 | 蓝色大肥鱼、GPT龙娘、大小姐Claude、北美猫娘Gemini，右键即时切换，选择会记住 |
| 离线抱盆 | 蓝色大肥鱼未配置凭证 / 连接中 / 连接失败时显示抱盆图，隐藏平板文字与金额飘字；连接成功自动恢复 |
| 扣费动画 | 每掉一分钱：红闪 + 震动 + 播放原版 `hit.mp3` + 飘出 `-0.01`，间隔 0.2 秒 |
| 充值动画 | 立即对齐真实余额，显示绿色扩散环，并飘出 `+金额` |
| 拖动与吸附 | 左键拖动，松手默认吸附左下角（可关）；位置、尺寸、角色都记住 |
| 鼠标穿透 | 透明区域直接点到底下的界面——用逐像素 alpha 命中测试，不是一个挡事的矩形 |
| 余额胶囊 | 常驻的小胶囊显示 `¥ 余额` 与状态点，点击打开菜单；桌宠隐藏时它是唯一入口 |
| 菜单 | 立即刷新、测试一次扣费、演示连续扣费 ×5、角色、尺寸、音效、刷新间隔、凭证来源、吸附、隐藏 |
| 尺寸 | 小 110 / 中 150 / 大 210 / 特大 280（角色高度，单位 CSS px） |

「测试一次扣费 / 演示连续扣费」只影响画面上显示的数字，**不发起任何请求，也不修改真实余额**。

## 安装

需要先装好 DSH（`npm install -g @deepseek-ai/dsh`，确认 `dsh --version` 有输出）。

```sh
# 从 GitHub 安装
dsh plugin --profile web add github:yanhualuoyu11/dsh-vk1-pet -w

# 或从本地目录（会链接该 checkout，改代码后重启即生效）
dsh plugin --profile web add /path/to/dsh-vk1-pet -w
```

然后重启 `dsh web`。桌宠出现在左下角，余额胶囊在它上方；右键桌宠或点击胶囊打开菜单。

卸载：

```sh
dsh plugin --profile web remove dsh-vk1-pet
```

> 安装走的是 git 仓库，但 `client/client.js` 是**已构建并提交**的产物，
> 所以 pnpm 不会执行任何构建脚本，也不会弹 `allowBuilds` 许可。

## 使用

| 操作 | 效果 |
| --- | --- |
| 左键拖动角色 | 移动桌宠；松手默认吸附左下角，可在菜单关闭 |
| 右键 / 点击余额胶囊 | 打开菜单 |
| 菜单 → 角色 | 切换四个角色，立即生效并记住 |
| 菜单 → 尺寸 | 四档角色高度 |
| 菜单 → 立即刷新余额 | 对齐真实余额，跳过排队动画 |
| 菜单 → 隐藏桌宠 | 收起桌宠，只留余额胶囊 |

## 凭证与余额

按顺序尝试，第一个可用的生效：

1. `DSHPET_KEY` 环境变量（字面 API Key，优先级最高，方便临时切换）。
2. DSH 凭证库里的引用（默认 `DEEPSEEK_API_KEY`，可用 `DSHPET_API_KEY_REF` 改名）。
   查找顺序就是 DSH 自己的顺序：启动环境 → `$DSH_HOME/.credentials.yaml` → 项目 `.env` → `$DSH_HOME/.env`。
   **在「设置 → 模型」里填过的 Key 会被自动使用，不需要再填一次。**
3. DSH 平台账号（`ctx.deepseekAccount`）。只有已登录时才查询；令牌始终留在宿主进程内，
   浏览器永远看不到凭证。

| 模式 | 请求 | 认证 |
| --- | --- | --- |
| API Key | `GET {endpoint}/user/balance` | `Authorization: Bearer …` |
| DSH 账号 | 由宿主走 DSH 平台的 `get_user_summary` | 宿主内部持有 |

- 只累加 **CNY** 钱包；USD 不会被当成人民币显示，缺少 CNY 会报错而不是显示 0。
- 金额以十进制定点整数（分）运算，**不使用浮点**，最后一步四舍五入到分。
  少一分钱就会触发震动和音效，浮点误差会被当成真实扣费。
- 默认 30 秒轮询一次，间隔从**上一次请求结束后**开始计算；命中 429 时优先遵守
  `Retry-After`（秒数或 HTTP 日期，最多 24 小时），否则指数退避到最多 5 分钟。
- 认证失败、网络错误或响应损坏都不会清空最后一次读数：界面保留旧数字并变灰。

## 配置

配置只有两个来源：环境变量与 `$DSH_HOME/dsh-vk1-pet/config.json`（菜单写入）。环境变量优先。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSHPET_HOME` | `$DSH_HOME/dsh-vk1-pet` | 插件自己的状态目录 |
| `DSHPET_KEY` | — | 字面 API Key，优先于凭证库 |
| `DSHPET_API_KEY_REF` | `DEEPSEEK_API_KEY` | 凭证引用名 |
| `DSHPET_SOURCE` | `auto` | `auto` / `api-key` / `account` |
| `DSHPET_INTERVAL` | `30` | 轮询秒数（10 / 30 / 60 / 300） |
| `DSHPET_ENDPOINT` | `https://api.deepseek.com` | 仅接受纯 HTTPS 源，拒绝带用户名、查询串或路径的地址 |
| `DSHPET_TIMEOUT_MS` | `20000` | 单次请求超时 |
| `DSHPET_LOCALE` | `zh_CN` | 传给 DSH 账号接口的界面语言 |
| `DSHPET_OFFLINE` | — | `1` 时完全跳过凭证读取与联网（演示用） |

浏览器侧的偏好（角色、尺寸、位置、音效、吸附、是否隐藏）存在该浏览器的 `localStorage`，
键前缀 `dsh-vk1-pet:v1:`。

## 工作原理

**为什么是网页桌宠。** VK-1 的全部价值在那只鱼：倾斜平板上滚动的余额、掉钱时的一下红闪和震动。
这些东西只有在界面上才有意义，所以插件形态选的是 `shell.overlay`——ui-layout 声明的
「全框悬浮层」，它位于所有栏目之上、默认鼠标穿透，正是桌宠需要的位置。

**透明区域真的穿透。** 悬浮层默认穿透，但一个 1.4:1 的矩形命中区会挡住底下的输入框。
插件把每张角色图降采样成一张 alpha 掩码，指针移动时逐像素判定，只有压到不透明像素
才把 `pointer-events` 切成 `auto`。所以鱼的四周、尾巴的空隙都能直接点到底下的界面。

**凭证不出宿主。** 浏览器只拿到一个只读投影（余额、状态、错误、来源标签）。API Key 与平台令牌
都留在 Node 进程里；每个 HTTP 路由先过 DSH 自己的 `requestRejection()`，
也就是 `/api` 用的同一套浏览器 Cookie 与 Host/Origin 栅栏。

**几何是移植的，不是估的。** 原版在 1536×1024 的原图上量了每块平板的三个角点。插件沿用同一组
数值，把它解成一个 CSS `matrix(...)`；测试逐点断言变换后的角点与测量值吻合，预览图也用同一组
矩阵离屏渲染。

**一次上游请求。** 浏览器每 2 秒读一次宿主**内存里**的状态；上游余额仍然只按配置的间隔请求一次，
开多少个标签页都只有一个上游请求。

## 仓库结构

```
.
├── dsh-vk1-pet/            插件包本体
│   ├── host/               宿主半边：纯 ESM，无构建、无运行时依赖
│   │   ├── index.js        cordis 插件入口
│   │   ├── balance.js      凭证解析 + 两种余额读取
│   │   ├── money.js        精确十进制 → 分，以及 429 退避解析
│   │   ├── poller.js       唯一的状态所有者：单飞请求、退避、手动刷新
│   │   ├── routes.js       /dsh-vk1-pet/api/* 与 /dsh-vk1-pet/assets/*
│   │   └── settings.js     环境变量 → 配置文件 → 默认值
│   ├── client/             浏览器半边
│   │   ├── index.jsx       插件入口 + 悬浮桌宠（esbuild 构建为 client.js）
│   │   ├── model.js        记账与动画状态机（原版 PetModel 的移植）
│   │   ├── constants.js    角色、尺寸、画布几何、平板仿射矩阵
│   │   ├── api.js          对宿主路由的调用
│   │   └── styles.js       注入的样式表
│   ├── assets/             五张 1536×1024 PNG + hit.mp3（来源与哈希见其 README）
│   └── test/               62 个用例
├── docs/previews/          离线渲染的效果预览
├── .verify/                可复现的验证脚手架（见其 README）
└── scripts/                维护者脚本
```

包级别的细节（配置、与桌面原版的逐项对应、素材溯源）见
[`dsh-vk1-pet/README.md`](dsh-vk1-pet/README.md)。

## 开发

宿主半边是手写 JS，Node 直接加载，没有构建步骤。只有浏览器半边需要 esbuild：

```sh
cd dsh-vk1-pet
npm install          # 只装 esbuild / react / react-dom / jsdom（开发依赖）
npm run build        # client/index.jsx → client/client.js
npm test             # 62 个用例
```

`client/client.js` 是构建产物，但已随仓库提交。

测试分三层：

- **纯逻辑**：金额解析与舍入、`Retry-After`、钱包求和、动画状态机、平板仿射几何、主题令牌配对。
- **字符串渲染**：构建产物能否通过 `window.__ModuleLoader__` 注册，`apply` 是否只占一个
  `shell.overlay` 席位，四个角色能否无异常渲染。
- **真实 DOM（jsdom）**：把同一个构建产物挂进 DOM，用打桩的 `fetch` 依次喂
  「连接中 → 已连接 → 连接失败 → 未配置」四种宿主状态，断言抱盆图与平板相互切换；
  再点开菜单触发一次扣费，检查金额飘字是否按状态显示。

想跑起真实界面，见 [`.verify/README.md`](.verify/README.md)。

## 已知限制

- 桌宠画在页面里，**不是**系统级桌面宠物；关掉 DSH 页面就看不到它。
- 余额变化依赖轮询，最短 10 秒；比这更快的花费会在下一次读数时按 0.2 秒一步补动画
  （超过 400 步直接对齐，避免长时间抖动）。
- 浏览器首次播放音效需要页面上已经有过用户交互（浏览器自动播放策略）。
- 没有实现账号登录 / 设置 API Key：这些交给 DSH 自己的设置页，插件只负责读。
- 平台账号模式只做过代码路径层面的对齐，没有在真实登录态下实测。

## 来源与许可

- 角色图片与 `hit.mp3` 逐字节复制自上游 [VKmich16/VK-1](https://github.com/VKmich16/VK-1)，
  每个文件都记录了 SHA-256 与平板坐标测量值，见
  [`dsh-vk1-pet/assets/README.md`](dsh-vk1-pet/assets/README.md)。
- 插件代码以 MIT 发布，见 [`dsh-vk1-pet/LICENSE`](dsh-vk1-pet/LICENSE)。
  **`assets/` 下的图片与音效不在 MIT 授权范围内**：上游未附许可证，本仓库只做原样分发、
  不额外授权，再利用前请自行与上游确认。
