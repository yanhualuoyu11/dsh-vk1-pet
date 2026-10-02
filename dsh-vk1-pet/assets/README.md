# 素材来源与校验

本目录的 5 张 PNG 与 1 个 MP3 都是从上游 VK-1 项目 **逐字节复制** 的，没有重绘、压缩、
缩放或重新编码。它们是本插件「角色长什么样、平板在哪、音效是什么」的唯一事实来源。

上游：[VKmich16/VK-1](https://github.com/VKmich16/VK-1) →
[`dsh-balance-pet-macos/Resources/`](https://github.com/VKmich16/VK-1/tree/main/dsh-balance-pet-macos/Resources)
（连同更早的 Windows 原版 `原版（Windows版）/DSH余额桌宠/`）。

| 文件 | 说明 | SHA-256 |
| --- | --- | --- |
| `sprite.png` | 1536 × 1024 RGBA，蓝色大肥鱼手持平板 | `a98329d36dd9169a1856f3a396bc9e602ed1a739bd3097eead1b744c6bb3dd71` |
| `sprite-gpt.png` | GPT龙娘：白发、龙角、龙尾 | `41f79346666fbb776ee2baef2a0cf044850a50e30c177b3adf9bb14e84296467` |
| `sprite-claude.png` | 大小姐Claude：橙发、花饰、无尾巴 | `81f0e787057dd9d5e400e5f43a44a1b55da4adfa7329aa712d986531cbd5d90d` |
| `sprite-gemini.png` | 北美猫娘Gemini：蓝紫发、异色瞳、毛绒尾巴 | `ad5fbeb07c2212476d4670ec56b8e7202e21f05b42ab0461cf3150a43f91a2ef` |
| `sprite-deepseek-offline.png` | 蓝色大肥鱼的抱盆图，仅用于未连接状态 | `fb4c5cb3001ca43d268d2e3bdf39b9d984e28d592e3b73e46e6fd44ccebb4555` |
| `hit.mp3` | 原版扣费打击音效 | `43fa877b537d8cbfbd676d76109b9a960551bfeae06c62e2d1a7d64d3994cb29` |

重新校验：

```sh
cd assets && sha256sum -c <<'SUMS'
a98329d36dd9169a1856f3a396bc9e602ed1a739bd3097eead1b744c6bb3dd71  sprite.png
41f79346666fbb776ee2baef2a0cf044850a50e30c177b3adf9bb14e84296467  sprite-gpt.png
81f0e787057dd9d5e400e5f43a44a1b55da4adfa7329aa712d986531cbd5d90d  sprite-claude.png
ad5fbeb07c2212476d4670ec56b8e7202e21f05b42ab0461cf3150a43f91a2ef  sprite-gemini.png
fb4c5cb3001ca43d268d2e3bdf39b9d984e28d592e3b73e46e6fd44ccebb4555  sprite-deepseek-offline.png
43fa877b537d8cbfbd676d76109b9a960551bfeae06c62e2d1a7d64d3994cb29  hit.mp3
SUMS
```

## 平板坐标为什么是这几个数字

余额文字要贴在每张图里那块倾斜的平板上。原版在 1536×1024 的原图上量了三个角点
（左上、右上、左下，以图片左上角为原点），本插件沿用同一组数值：

| 角色 | 左上 TL | 右上 TR | 左下 BL |
| --- | --- | --- | --- |
| 蓝色大肥鱼 / GPT龙娘 / 大小姐Claude | (1060, 699) | (1413, 644) | (1090, 889) |
| 北美猫娘Gemini | (1065, 699) | (1400, 646) | (1095, 889) |

Gemini 的右手伸进屏幕更多，所以文字安全区单独收窄以避开手指。这三个点加一个 400×220 的
逻辑平板矩形，唯一确定一个仿射变换；`client/constants.js` 的 `tabletMatrix()` 把它写成
CSS `matrix(...)`，`test/constants.test.mjs` 断言变换后的三个角点与上表逐点吻合。

## 许可

上游目前**没有**附带许可证。本插件因此只对自己的代码授予 MIT（见 `../LICENSE`），
对这里的图片与音效不另行授权：它们按原样随包分发，来源与哈希如上，任何再利用请自行
向上游确认。
