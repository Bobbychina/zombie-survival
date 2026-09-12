# 隐私与权限说明（zombie-survival / bobbychina.github.io/games）

这份文档说明这个游戏与游戏厅**会碰你哪些数据、存在哪里、怎么删掉**。站点的页面本身是静态的，但账号系统有两种模式，请看清你用的是哪种。

---

## 1. 两种账号模式

| 模式 | 什么时候用 | 数据存在哪 |
|---|---|---|
| **💻 本机模式** | 没有配置云后端（或云后端暂时连不上） | 只存在**你自己的浏览器**里，不联网、不上传任何东西 |
| **☁️ 云模式** | 站点配了云后端（`/games/auth-config.js` 里的 `api`） | 存在**部署者自己的 Cloudflare 账号**（Worker + KV）里，用于跨设备登录与存档同步 |

> 公开游戏厅 <https://bobbychina.github.io/games/> 目前是**云模式**：也就是说，你在那里注册的账号与上传的存档，存在 **Bobbychina 自己的 Cloudflare KV** 中，不在任何第三方商业服务里，也不用于任何别的用途（没有分析、没有广告、没有对外分享）。

## 2. 云模式下具体存了什么

| 位置 | 存了什么 | 谁控制 |
|---|---|---|
| 你的浏览器 `localStorage` | 登录会话（含服务端令牌）、本地存档镜像、账号"壳"（用户名、盐、本机口令哈希）、可选的 GitHub 绑定令牌 | 你（清浏览器数据即消失） |
| Cloudflare KV（部署者的账号） | 用户名、盐、`SHA256(pepper + 客户端派生值)`、会话令牌的 `SHA256`（带过期）、你上传的存档原文 | 部署者（游戏厅是 Bobbychina，则为他本人） |
| 你的 GitHub 私有 Gist（**可选**，仅在你主动绑定时） | 存档 JSON | 你（随时可删） |

**没有的东西**：没有第三方统计/埋点、没有广告、没有 Cookie 跟踪、没有把数据卖给或分享给任何第三方、没有把你的存档用于训练。

### 口令是怎么处理的

1. 浏览器用 WebCrypto **PBKDF2-SHA256（210,000 轮 + 16 字节随机盐）** 把口令派生成 `verifier`；
2. 只把 `verifier`（不是口令）发给服务端；
3. 服务端存的是 `SHA256(pepper + verifier)`，其中 **`pepper` 是 Worker 的 Secret，不在数据库里**。

也就是说：**服务端永远看不到你的原始口令**；即使 KV 数据被拖走，没有 `pepper` 也无法构造出可登录的凭据；即使 `pepper` 泄漏，没有 KV 也拿不到任何哈希。登录接口按 IP 限流（每分钟 20 次）挡暴力猜口令。

## 3. 绑定 GitHub 时申请的权限（只有你主动点绑定时才会发生）

申请范围写死在 `games/auth-config.js` 的 `scope: 'gist read:user'`。

| 权限 | 授权页上的说法 | 我们用它做什么 | 我们**不做**什么 |
|---|---|---|---|
| `gist` | Gists — Read and write access | 创建**一个私有 Gist**（描述为 `bobbychina.github.io/games 云存档`），在里面按 `<游戏>__<槽位>.json` 读写存档 | 不读你的仓库、issue/PR/Actions，不改你的代码 |
| `read:user` | Personal user data — Profile information (read-only) | **只在绑定那一刻**读一次用户名与头像用于界面显示 | 不读邮箱、不读关注列表、不写任何资料 |

代价（GitHub 的粒度限制，不是我们能收窄的）：`gist` 是**全量**授权——拿到令牌的人理论上能读写你账号下所有 Gist（**碰不到仓库与代码**）；令牌只存在你这台设备的浏览器里，别在公用电脑上绑定。

## 4. 你随时能收回

| 想做什么 | 怎么做 |
|---|---|
| 撤销 GitHub 授权 | <https://github.com/settings/applications> → Authorized OAuth Apps → `bobbychina's games` → **Revoke** |
| 删云端存档 | 账号面板里的「删除」，或直接删掉那个私有 Gist |
| **删云账号（含服务端数据）** | 账号面板 → **🗑️ 注销账号**：会同时删掉 Cloudflare KV 里这个账号的用户名记录、会话与全部存档 |
| 清掉本机一切 | 注销账号，或清空该站点的浏览器数据 |
| 什么都不想连 | 用「💾 导出存档文件 / 📂 从文件导入」——完全不涉及任何账号与服务端 |

## 5. 关于微软登录

当前**未启用**（个人微软账号在 Azure 注册应用会被要求绑信用卡）。代码保留在 `src/account/account.js`，填上 client ID 即可启用；若启用，权限为 `openid profile offline_access User.Read Files.ReadWrite.AppFolder`：只读显示名与邮箱，以及**仅限应用自己的文件夹** `/dsh-saves` 的读写。

## 6. 未成年人 / 校园环境

本项目是个人作品，不面向公众提供服务、不收集他人数据。如果你在学校设备上玩：账号与令牌会留在这台设备的浏览器里；云账号可在面板里一键注销（会清掉服务端数据）。

---

有任何一条与代码不符，欢迎提 issue 指出来——**以代码为准**（`tools/cf-worker.js`、`src/account/account.js`）。
