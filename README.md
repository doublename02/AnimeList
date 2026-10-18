# Anime Shelf · 我的动画手账

基于 Bangumi 的个人动画收藏网站，适配电脑和手机。前端是原生 HTML、CSS 和 JavaScript，无需构建；可以部署到自己的 GitHub Pages。可选的 Cloudflare Worker 让你在网页编辑后自动提交清单到 GitHub，无需数据库。

[在线演示](https://doublename02.github.io/AnimeList/)

这份指南面向希望克隆本仓库、维护自己的清单并自行部署的使用者。仓库目前包含作者的收藏和部署配置；**克隆后需要替换为你自己的账号、仓库和 Worker 地址**，不会自动获得演示站的编辑权限。

## 功能

- 搜索 Bangumi 中文名或原名，添加作品封面、名称、制作公司、首播年份、季度及短评。
- 默认补齐系列的 TV / 网络动画季度，确认前可取消；不自动补入电影、OVA、总集篇或独立特别篇。
- 按名称、制作公司搜索，按年份、季度筛选，支持添加时间、放送时间和名称的正序 / 倒序排序。
- 添加时间排序下，同系列季度连续显示，后续补入的新季仍归入同组。
- JSON 导入、导出；可选管理员登录、自动提交、失败草稿恢复及跨设备冲突合并。
- 访客只读；不记录观看状态。

## 选择部署方式

| 方式 | 需要的服务 | 如何更新清单 |
| --- | --- | --- |
| 仅静态展示 | GitHub Pages | 修改仓库的 `data/library.json` 后提交 |
| 网页编辑与自动同步 | GitHub Pages、Cloudflare Workers、自己的 GitHub App | 管理员登录网页后编辑，自动提交 GitHub |

两种方式的清单都保存在仓库中。自动同步使用自己的 GitHub App 和 Worker，不需要部署数据库。以下自动同步步骤以**个人 GitHub 账号拥有仓库并担任唯一管理员**为例。

## 1. 克隆并建立自己的仓库

准备 Git；本地预览和部署工具还需要 Node.js 22 或更新版本。

```sh
git clone https://github.com/doublename02/AnimeList.git
cd AnimeList
```

在 GitHub 创建一个空仓库，然后把本地的远程地址换成自己的地址。下列 `YOUR_USERNAME`、`YOUR_REPO` 等占位符都需要替换：

```sh
git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

也可以直接 Fork 本仓库，再克隆自己的 Fork。保留 `.github/workflows/pages.yml`，它负责发布网页。

### 更换初始清单和图标

- 将 `data/library.json` 改为 `[]`，即可从空书架开始；也可以放入已有的导出文件。
- `favicon.jpg` 是标签页图标，可替换为自己的图片。
- 作者的本地封面位于 `AnimeList/Covers/`。清空初始清单后，可删除不再引用的封面；保留使用中的图片。
- 即使仓库改名，封面目录仍保持 `AnimeList/Covers/`：这是当前代码允许的资源路径，与 GitHub 仓库名无关。

先修改 `sync-config.json`，断开演示站的接口：

```json
{
  "apiBase": "",
  "owner": "YOUR_USERNAME"
}
```

`apiBase` 为空时网站只读。`owner` 仅是配置中的账号标识；真正的编辑权限由 Worker 的账号数字 ID 和登录名校验，修改此字段不会授予权限。

## 2. 发布 GitHub Pages

1. 把上述修改提交并推送到自己的 `main` 分支。
2. 打开仓库 **Settings → Pages → Build and deployment**，将 Source 设为 **GitHub Actions**。
3. 打开 **Actions → Deploy GitHub Pages → Run workflow**，或提交一次修改触发部署。Fork 后若 Actions 未启用，先启用工作流。
4. 部署成功后，访问部署结果中的网址，通常为 `https://YOUR_USERNAME.github.io/YOUR_REPO/`。

```sh
git add .
git commit -m "Configure my anime shelf"
git push -u origin main
```

到这里已可使用静态展示模式。以后更新 `data/library.json` 并提交到 `main`，工作流会重新发布。若要从网页添加和编辑作品，继续完成下面的自动同步配置。

## 3. 部署自己的 Cloudflare Worker

在 `worker/wrangler.toml` 中修改 Worker 名称，并替换 **全部** `[vars]` 值：

```toml
name = "my-anime-shelf-sync"
main = "index.mjs"
compatibility_date = "2026-10-18"
workers_dev = true

[vars]
FRONTEND_URL = "https://YOUR_USERNAME.github.io/YOUR_REPO/"
GITHUB_OWNER = "YOUR_USERNAME"
GITHUB_REPO = "YOUR_REPO"
GITHUB_BRANCH = "main"
GITHUB_REPOSITORY_ID = "YOUR_REPOSITORY_NUMERIC_ID"
ALLOWED_USER_ID = "YOUR_USER_NUMERIC_ID"
ALLOWED_LOGIN = "YOUR_USERNAME"

[observability]
enabled = false
```

| 配置 | 应填写的值 |
| --- | --- |
| `FRONTEND_URL` | 实际网页完整地址，包含仓库路径及末尾 `/`；自定义域名也填写实际地址 |
| `GITHUB_OWNER` / `GITHUB_REPO` | 你的仓库所有者和仓库名 |
| `GITHUB_BRANCH` | 保存清单的分支；若不是 `main`，同时修改 Pages 工作流监听的分支 |
| `GITHUB_REPOSITORY_ID` | 访问 `https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO`，读取顶层 `id` |
| `ALLOWED_USER_ID` | 访问 `https://api.github.com/users/YOUR_USERNAME`，读取顶层 `id` |
| `ALLOWED_LOGIN` | 唯一管理员的 GitHub 登录名 |

数字 ID 不是用户名，也不是仓库名称。源码 `worker/index.mjs` 中保留了演示站默认值，Wrangler 的环境变量会覆盖它们，因此不要遗漏配置项。如果使用控制台粘贴打包代码，也必须设置上述全部环境变量。

在项目根目录运行官方部署工具：

```sh
npx wrangler@4 login
npx wrangler@4 deploy --config worker/wrangler.toml
```

记录部署输出中的 Worker HTTPS 根地址，例如 `https://my-anime-shelf-sync.YOUR_SUBDOMAIN.workers.dev`。此时尚未设置密钥，接口不会允许登录；继续下一步。

## 4. 创建并安装自己的 GitHub App

在 [GitHub App 设置](https://github.com/settings/apps/new) 创建私人 App：

| 项目 | 设置 |
| --- | --- |
| GitHub App name | 自定义一个未被占用的名称 |
| Homepage URL | 你的 GitHub Pages 完整地址 |
| Redirect URI / Callback URL | 你的 Worker 根地址 + `/auth/callback` |
| Expire user authorization tokens | 开启 |
| Request user authorization during installation | 关闭 |
| Device Flow | 关闭 |
| Webhook Active | 关闭 |
| Repository permissions → Contents | Read and write |
| Metadata | GitHub 自动要求的 Read-only |
| 其他权限 | No access |
| Where can this App be installed? | Only on this account |

创建后，在 **Install App** 选择自己的账号，再选择 **Only select repositories**，仅安装到你的清单仓库。

在 App 设置中记录 **Client ID**，并在 **Credentials → Client secrets** 生成一个 Client secret。这里使用用户 OAuth 流程，无需 App 私钥或个人访问令牌。

将以下三项保存为 Worker Secret：

```sh
npx wrangler@4 secret put GITHUB_CLIENT_ID --config worker/wrangler.toml
npx wrangler@4 secret put GITHUB_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler@4 secret put SESSION_SECRET --config worker/wrangler.toml
```

每条命令会提示输入对应值。`SESSION_SECRET` 是你自己生成的独立随机密钥，可在本机运行以下命令生成，再输入到提示中：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

密钥只保存在 Cloudflare Secrets，不要写进前端、README 或 Git 提交。重新设置 `SESSION_SECRET` 会使现有登录会话失效。

## 5. 连接网页并验证自动同步

将 `sync-config.json` 改为自己的接口地址，`apiBase` 不带末尾 `/` 或其他路径：

```json
{
  "apiBase": "https://my-anime-shelf-sync.YOUR_SUBDOMAIN.workers.dev",
  "owner": "YOUR_USERNAME"
}
```

提交并推送配置，等待 Pages 部署完成。然后验证：

1. 打开 `你的 Worker 地址/health`，应返回 `{"ready":true}`；这仅表示配置齐全。
2. 在自己的网页点击“管理员登录”，使用配置的管理员账号完成 GitHub 授权。
3. 添加或编辑一部作品。状态应变为“已提交 GitHub”，并出现“查看提交”链接。
4. 检查自己的仓库 `data/library.json` 和 Actions；部署完成后，访客能看到更新。
5. 退出管理员，确认网页恢复只读。

管理员保存时先保留本地草稿，再自动提交仓库；访客看到的是 Pages 最近发布的版本，更新会有部署延迟。其他设备登录会直接读取 GitHub 最新清单。网络失败可重试；版本冲突需要选择合并结果后再保存。会话最长一小时，到期重新登录。

只复制代码不会复制作者的 GitHub App、密钥或 Cloudflare 权限。请确认上述地址、数字 ID 和 App 安装目标全部属于自己的部署。

## 本地预览

在项目根目录运行：

```sh
node scripts/preview.mjs
```

访问 `http://127.0.0.1:4173/`。预览服务只开放网页文件，不提供 Git 元数据。请通过 HTTP 访问，直接双击 HTML 无法正常读取 JSON。

生产 Worker 仅接受配置的网站来源；本地预览用于查看页面，不能直接编辑生产清单。前端没有 npm 依赖，也没有构建步骤；Wrangler 仅用于部署 Worker。

## 导入和维护清单

导入接受 JSON **作品数组**，推荐使用网页导出的文件。`id` 为唯一的正整数 Bangumi 作品 ID，`title` 为非空名称，其余字段可省略：

```json
[
  {
    "id": 23686,
    "title": "刀剑神域 第一季",
    "original": "ソードアート・オンライン",
    "cover": "",
    "studio": "A-1 Pictures",
    "year": 2012,
    "season": "summer",
    "date": "2012-07-07",
    "note": "",
    "addedAt": "2026-01-01T00:00:00.000Z"
  }
]
```

- 导入会**替换当前清单**，先导出备份。文件最多 10 MB、10000 部作品，ID 不可重复。
- `season` 为 `winter`、`spring`、`summer`、`autumn` 或空字符串；季度按首播月份归类。
- 封面支持 HTTPS 图片地址，或 `AnimeList/Covers/` 下的相对路径。本地图片也需要提交到仓库。
- 同系列可保存 `seriesId`、`seriesTitle`、`seriesOrder`、`sourceTitle`，并共用 `addedAt`，以保持系列成组排序。网页添加时会处理这些字段，导入时应保留它们。
- 未公布的年份、季度、制作公司及日期可留空。制作公司优先读取 Bangumi 的“动画制作”字段，缺失时可手动补充。

仓库附带作者的示例收藏；[多季度系列清单](docs/series.md) 对应这份初始数据，不代表你后续维护的清单。

## 项目结构与排查

| 路径 | 用途 |
| --- | --- |
| `index.html`、`style.css`、`app.js` | 网页界面 |
| `series.mjs`、`library.mjs`、`sync.mjs` | 系列整理、清单校验及同步逻辑 |
| `data/library.json` | 公开清单 |
| `AnimeList/Covers/`、`favicon.jpg` | 本地封面及标签页图标 |
| `sync-config.json` | 前端公开接口地址 |
| `worker/` | Cloudflare 同步接口及部署配置 |
| `.github/workflows/pages.yml` | Pages 发布流程 |

- **提示同步未配置**：检查 `sync-config.json` 的 `apiBase`，并确认最新提交已发布。
- **无法登录或没有编辑权限**：检查 Worker 的账号 / 仓库数字 ID、App 安装范围、Client ID / Secret 和回调地址。
- **登录后没有回到正确网页**：检查 `FRONTEND_URL`，必须包含你的仓库路径。
- **保存成功但访客仍看到旧清单**：检查 Actions 部署结果，完成后刷新页面。
- **搜索或封面加载失败**：新作品搜索依赖 `api.bgm.tv`，远程封面依赖图片来源；网络、跨域策略或限流可能影响访问。

开发时可运行 `node --test tests/*.test.mjs`，验证排序、清单格式、同步冲突及接口权限。

[自动同步技术说明](docs/auto-sync.md) 包含接口与会话细节，其中作者部署的具体账号和地址仅作示例，自行部署以本 README 的替换步骤为准。

作品资料来自 [Bangumi](https://bgm.tv/)，使用其[公共 API](https://bangumi.github.io/api/)。公开部署的网站及其清单可被他人浏览；访客不能通过本项目的保存接口修改记录。Pages 仅发布网页、清单和图片；公开仓库中的其他已提交文件仍可被访问。
