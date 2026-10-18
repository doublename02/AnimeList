# 自动同步到 GitHub

网页继续由 GitHub Pages 托管，清单仍保存在 `doublename02/AnimeList` 的 `main` 分支、`data/library.json` 文件中。Cloudflare Worker 负责登录和保存，不需要数据库。

接口地址：`https://anime-shelf-sync.akiracheah12.workers.dev`

## 日常使用

1. 在网站点击“管理员登录”，使用 `doublename02` 完成 GitHub 授权。
2. 新增、修改、删除或导入清单后，网页先保存本地草稿，再自动提交 GitHub。
3. 状态栏显示“已提交 GitHub”后，可点击“查看提交”核对结果。Pages 随后自动部署，访客在部署完成后看到更新。
4. 在另一台设备登录后，直接读取 GitHub 最新版本，不依赖浏览器旧数据。

访客只能浏览、筛选和导出，不能提交修改。账号以 GitHub 数字 ID `113842800` 和登录名共同校验，不接受其他账号，即使他人拿到了接口网址。

网络失败时保留草稿，可点击“重试同步”；重新打开同一标签页并登录后，会尝试恢复本账号的未同步草稿。不要清除浏览器网站数据，否则未提交的草稿会丢失。旧版网页的本地记录仍保留，登录后可通过“恢复本地备份”导入，恢复前可先导出当前云端清单。

云端已被其他设备修改时，服务器以文件 SHA 拒绝旧版本写入，不会强制覆盖。网页展示差异，未冲突的字段自动合并，有冲突的作品由你逐项选择本地或云端版本，确认后才再次保存。退出管理员会撤销当前 GitHub 用户令牌。会话最长一小时，到期重新登录。

## 一次性配置 GitHub App

在 [GitHub App 设置](https://github.com/settings/apps)创建一个仅当前账号可安装的 App：

| 项目 | 设置 |
| --- | --- |
| 名称 | Anime Shelf Sync doublename02 |
| Homepage URL | `https://doublename02.github.io/AnimeList/` |
| Redirect URI / Callback URL | `https://anime-shelf-sync.akiracheah12.workers.dev/auth/callback` |
| Expire user authorization tokens | 开启 |
| Request user authorization during installation | 关闭；从网页登录按钮进入完整验证流程 |
| Device Flow | 关闭 |
| Webhook Active | 关闭 |
| Repository permissions → Contents | Read and write |
| Metadata | GitHub 自动要求的 Read-only |
| 其他权限 | No access，无需 Workflows、Actions、账号或组织权限 |
| Where can this App be installed? | Only on this account |

创建后在“Install App”选择 **Only select repositories → AnimeList**。生成一个 Client secret，只保存到 Cloudflare Secret。无需生成 GitHub App 私钥，也无需个人访问令牌。

GitHub 的 Contents 权限覆盖已安装仓库的内容；本服务进一步将 API 路由固定为 `data/library.json`，并在 OAuth 交换时将用户令牌限制到仓库数字 ID `1423929539`。

## 部署 Cloudflare Worker

源码为 `worker/index.mjs`，配置为 `worker/wrangler.toml`，共享清单校验位于 `library.mjs`。

### 通过命令行部署

先登录 Cloudflare 官方 Wrangler，再从项目根目录执行：

```powershell
npx wrangler@4 deploy --config worker/wrangler.toml
npx wrangler@4 secret put GITHUB_CLIENT_ID --config worker/wrangler.toml
npx wrangler@4 secret put GITHUB_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler@4 secret put SESSION_SECRET --config worker/wrangler.toml
```

在命令的交互提示中输入对应值，不要把密钥放进命令参数、网页或 GitHub 文件。`SESSION_SECRET` 应为密码学随机生成的至少 32 字节、编码后至少 43 字符的独立密钥。变更它会使旧登录会话失效。

### 通过 Cloudflare 控制台部署

运行 `node scripts/build-worker.mjs` 生成无依赖的 `worker/dist/worker.mjs`，将内容放入 Worker 的代码编辑器并部署。在 Worker 的 **Settings → Variables and Secrets** 中把上面三项设置为 **Secret**，再保存部署。非敏感的账号、仓库和站点配置已内置默认值，也可用同名环境变量覆盖。

不要开启请求体或 Authorization 记录。项目配置关闭 Workers Observability；接口不会打印访问令牌、Client secret 或清单内容。

`GET /health` 返回 `{"ready":true}` 表示必要配置齐全；它不代表 GitHub App 已正确安装，需要实际登录验证。

## 连接前端

将 `sync-config.json` 的 `apiBase` 设置成接口的 HTTPS 根地址（不带末尾路径），然后提交到 `main`。前端配置只包含公开地址，不能加入密钥。为空时网站保持只读，并提示同步尚未配置。

Pages 工作流只上传网页、清单和封面，不会发布 Worker、测试代码或部署密钥。`.gitignore` 排除 `.dev.vars`、`.env`、私钥和临时打包文件。

## 验证及接口

```powershell
node --test tests/*.test.mjs
node scripts/preview.mjs
```

预览只监听本机 `127.0.0.1:4173`，只允许网页文件，不提供 Git 元数据。生产服务仅接受已配置网页来源的认证请求；本地预览为访客只读。

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 公开配置状态，不返回密钥 |
| `GET /auth/login` | 开始带 state 和 PKCE 的 GitHub App 登录 |
| `GET /auth/callback` | 校验回调，将短时加密会话带回固定网页 |
| `GET /auth/session` | 校验当前管理员身份 |
| `POST /auth/logout` | 撤销当前用户令牌 |
| `GET /library` | 管理员直接读取仓库最新清单和 SHA |
| `PUT /library` | 校验清单后，以 SHA 比较并提交固定 JSON 文件 |

浏览器仅在当前标签页的 sessionStorage 保存短时加密会话，GitHub Client secret 和会话解密密钥均在 Cloudflare。登录跳转会话经 URL fragment 返回，前端在任何网络操作前将它从地址栏移除。普通本地存储只保存清单草稿，不保存明文 GitHub 令牌。

相关官方说明：[GitHub App 用户登录](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[文件版本写入](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)、[Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
