# dsh-vk1-pet

把 [VK-1](https://github.com/VKmich16/VK-1)（DSH 余额桌宠）做成 **DeepSeek Harness 的 web 插件**：
一个包，一个悬浮在 DSH 网页界面上的大肥鱼桌宠，余额显示在她手持的平板上。

原版是独立的 macOS/Windows 应用，需要自己读凭证文件、自己开窗口、自己轮询余额。
作为 DSH 插件，这些事交回给 DSH 本身：宿主侧用 `ctx.credentials` / `ctx.deepseekAccount`
读凭证并轮询余额，浏览器侧只负责画那只鱼。**没有独立进程，没有额外窗口，跨平台。**

## 效果

![桌宠总览](../../docs/previews/contact-sheet.png)

从左到右：连接中（蓝色大肥鱼 · 中号）、扣费瞬间（红闪 + `-0.01` 飘字 + 震动）、
充值（绿环）、未连接（抱盆图）、北美猫娘 Gemini（大号，文字区避开手指）、
GPT龙娘（特大，长金额自动缩小）、大小姐 Claude（小号）。

## 功能

| 功能 | 说明 |
| --- | --- |
| 余额显示 | 余额、`¥` 符号与连接状态点一起绘制在角色手持的倾斜平板上，跟随震动 |
| 四个角色 | 蓝色大肥鱼、GPT龙娘、大小姐Claude、北美猫娘Gemini，右键或余额胶囊即时切换，重启后保留 |
| 离线抱盆 | 蓝色大肥鱼未配置凭证 / 连接中 / 连接失败时显示抱盆图，隐藏平板文字与金额飘字；连接成功自动恢复 |
| 扣费动画 | 每掉一分钱：红闪 + 震动 + 播放原版 `hit.mp3` + 飘出 `-0.01`，间隔 0.2 秒 |
| 充值动画 | 立即对齐真实余额，显示绿色扩散环，并飘出 `+金额` |
| 拖动与吸附 | 左键拖动，松手默认吸附左下角（可关）；透明区域鼠标穿透 |
| 余额胶囊 | 常驻的小胶囊显示 `¥ 余额` 与状态点，点击打开菜单；桌宠隐藏时它是唯一入口 |
| 菜单 | 立即刷新、测试一次扣费、演示连续扣费 ×5、角色、尺寸、音效、刷新间隔、凭证来源、吸附、隐藏 |
| 尺寸 | 小 110 / 中 150 / 大 210 / 特大 280（角色高度，单位 CSS px） |

演示扣费只影响画面上显示的数字，**不会**发起任何请求，也不会修改真实余额。

## 安装

```sh
# 从本地目录安装（会链接当前 checkout，改代码后重启 dsh web 即生效）
dsh plugin --profile web add /path/to/dsh-vk1-pet -w

# 或从 npm / git 安装
dsh plugin --profile web add dsh-vk1-pet -w
dsh plugin --profile web add github:you/dsh-vk1-pet -w
```

然后重启 `dsh web`：

```sh
dsh web
```

打开界面后，桌宠出现在左下角，余额胶囊在它上方。右键桌宠或点击胶囊打开菜单。

卸载：

```sh
dsh plugin --profile web remove dsh-vk1-pet
```

## 凭证与余额

按顺序尝试，第一个可用的生效：

1. `DSHPET_KEY` 环境变量（字面 API Key，优先级最高，方便临时切换）。
2. DSH 凭证库里的引用（默认 `DEEPSEEK_API_KEY`，可用 `DSHPET_API_KEY_REF` 改名）。
   查找顺序就是 DSH 自己的顺序：启动环境 → `$DSH_HOME/.credentials.yaml` → 项目 `.env` → `$DSH_HOME/.env`。
   也就是在「设置 → 模型」里填过的 Key 会自动被桌宠使用，不需要再填一次。
3. DSH 平台账号（`ctx.deepseekAccount`）。只有已登录时才查询，令牌始终留在宿主进程内，
   浏览器永远看不到凭证。

| 模式 | 请求 | 认证 |
| --- | --- | --- |
| API Key | `GET {endpoint}/user/balance` | `Authorization: Bearer …` |
| DSH 账号 | 由 `ctx.deepseekAccount.getBalance()` 走 DSH 平台的 `get_user_summary` | 宿主内部持有 |

余额只累加 **CNY** 钱包；USD 不会被当成人民币显示，缺少 CNY 会直接报错而不是显示 0。
金额以十进制定点整数（分）运算，不使用浮点，最后一步四舍五入到分。

轮询：默认 30 秒，可选 10 / 30 / 60 / 300 秒，间隔从**上一次请求结束后**开始计算。
命中 429 时优先遵守 `Retry-After`（秒数或 HTTP 日期，最多 24 小时），否则指数退避到最多 5 分钟。
认证失败、网络错误或响应损坏都不会清空最后一次读数，界面保留旧数字并变灰。

## 配置

宿主侧配置只有两个来源：环境变量与 `$DSH_HOME/dsh-vk1-pet/config.json`（菜单写入）。
环境变量优先。

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
| `DSHPET_OFFLINE` | — | `1` 时完全跳过凭证读取与联网（演示 / 离线验证用） |

浏览器侧偏好（角色、尺寸、位置、音效、吸附、是否隐藏）存在该浏览器的 `localStorage`，
键前缀 `dsh-vk1-pet:v1:`。

## 它长在 DSH 的哪里

```
dsh-vk1-pet/
├── host/                  宿主半边（纯 ESM，无构建、无运行时依赖）
│   ├── index.js           cordis 插件入口：装配轮询器与路由
│   ├── balance.js         凭证解析 + 两种余额读取
│   ├── money.js           精确十进制 → 分，以及 429 退避解析
│   ├── poller.js          唯一的状态所有者：单飞请求、退避、手动刷新
│   ├── routes.js          /dsh-vk1-pet/api/* 与 /dsh-vk1-pet/assets/*
│   └── settings.js        环境变量 → 配置文件 → 默认值
├── client/                浏览器半边
│   ├── index.jsx          插件入口 + 悬浮桌宠组件（esbuild 构建为 client.js）
│   ├── model.js           记账与动画状态机（PetModel 的移植）
│   ├── constants.js       角色、尺寸、画布几何、平板仿射矩阵
│   ├── api.js             对宿主路由的调用
│   └── styles.js          注入的样式表
└── assets/                5 张 1536×1024 PNG + hit.mp3（来源见 assets/README.md）
```

- **宿主**注册进 DSH 自己的 web server，路由前缀 `/dsh-vk1-pet`。每个请求先过
  `ctx.connection.requestRejection()`，也就是 `/api` 用的同一套浏览器 Cookie 与
  Host/Origin 栅栏；没有 `connection` 服务时退化为仅回环。
- **浏览器**注册进 `shell.overlay` —— ui-layout 声明的「全框悬浮层」，默认鼠标穿透，
  正是桌宠需要的位置。桌宠只在指针压到不透明像素时才接管事件（用一张降采样的
  alpha 掩码做逐像素命中测试），所以它永远不会挡住底下的界面。
- 浏览器每 2 秒读一次宿主**内存里**的状态；上游余额仍然只按配置的间隔请求一次，
  开多少个标签页都只有一个上游请求。

## 从源码构建

宿主半边是手写 JS，Node 直接加载，没有构建步骤。只有浏览器半边需要 esbuild：

```sh
npm install          # 只装 esbuild / react / react-dom（开发依赖）
npm run build        # client/index.jsx → client/client.js
npm test             # 62 个用例：金额、退避、状态机、几何、构建产物渲染
```

（在文件写入受限的沙箱里，npm 可能需要显式指定缓存目录：`npm install --cache ../.npm-cache`。）

`client/client.js` 是构建产物，但**已随包提交**，所以 `dsh plugin add` 之后无需任何构建。

## 与桌面原版的对应关系

| 原版（Swift/AppKit） | 本插件 |
| --- | --- |
| `PetLayout` 画布与平板仿射 | `client/constants.js` 的 `layoutOf` / `tabletMatrix`（同一组测量角点） |
| `PetModel` 记账与动画 | `client/model.js`（0.2 秒步进、0.55 秒受击、0.95 秒飘字、400 步上限） |
| `BalanceClient` 响应解析 | `host/money.js` + `host/balance.js` |
| `PetController` 菜单与轮询 | `client/index.jsx` 的菜单 + `host/poller.js` |
| 菜单栏 `¥` 图标 | 常驻余额胶囊 |
| `NSWindow` 透明区域穿透 | 逐像素 alpha 命中测试 + `pointer-events` 切换 |
| 窗口位置 / 配置目录 | `localStorage` + `$DSH_HOME/dsh-vk1-pet/config.json` |

macOS 版 0.01 元一次的红闪、震动幅度、飘字轨迹与音效节奏都按原参数移植；金额从
十进制定点整数运算，避免浮点误差被误判成扣费。

## 已知限制

- 桌宠画在窗口内，**不是**系统级桌面宠物；关掉 DSH 页面就看不到它。
- 余额变化依赖轮询，最短 10 秒；比这更快的花费会在下一次读数时按 0.2 秒一步补动画
  （超过 400 步直接对齐，避免长时间抖动）。
- 浏览器首次播放音效需要页面上已经有过用户交互（浏览器自动播放策略）。
- 没有实现账号登录 / 设置 API Key：这些交给 DSH 自己的设置页，插件只负责读。

## 素材与许可

代码以 MIT 发布，见 [`LICENSE`](LICENSE)。`assets/` 下的角色图片与音效**不在** MIT
授权范围内：它们来自上游 VK-1 项目，本包只是逐字节复制并保留来源说明，详见
[`assets/README.md`](assets/README.md)。
