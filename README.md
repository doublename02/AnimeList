# Anime Shelf · 我的动画手账

无需构建、无需安装依赖的静态动画清单，适配电脑与手机，可部署到 GitHub Pages。

## 本地预览

在项目目录运行 `python -m http.server 4173`，然后访问 http://localhost:4173 。请通过 HTTP 打开，直接双击 HTML 无法加载 JSON。

## 使用

- 点击“添加作品”，输入中文名或原名搜索 Bangumi，点击收藏后确认资料。
- 记录封面、中日文名称、动画制作公司、首播年份和季度及短评。
- 季度按首播月份推算：1–3 月为冬季、4–6 月为春季、7–9 月为夏季、10–12 月为秋季。跨季度播出的作品仍归入首播季度。
- 制作公司优先取 Bangumi 的“动画制作”字段，资料缺失时可手动补充。
- 修改自动保存到当前浏览器的 localStorage；清除网站数据或换设备后，本地修改不会保留。
- “导出清单”下载完整的 `library.json`；用它替换仓库里的 `data/library.json` 并提交，重新部署后其他设备和访客即可看到。已有本地清单的浏览器会继续优先使用本地版本，可通过“导入清单”替换。
- 导入会替换当前清单，建议先导出备份。不会自动覆盖 Obsidian 笔记。

初始数据从《刀剑神域》Obsidian 记录迁入，保留网站使用的封面。原 Obsidian 笔记、设置及插件已清理；后续通过网页维护清单。

## 部署到自己的 GitHub

1. 在 GitHub 创建仓库，把本目录文件上传到仓库的 `main` 分支，包含隐藏目录 `.github`。
2. 打开仓库 **Settings → Pages → Build and deployment**，Source 选择 **GitHub Actions**。
3. 打开 **Actions → Deploy GitHub Pages → Run workflow**（后续提交到 main 会自动部署）。
4. 等待成功后，打开部署结果中的网址，一般是 `https://你的用户名.github.io/仓库名/`。

部署仅打包网页、JSON 和封面。若仓库本身公开，仓库内所有已提交文件仍可被访问。无需 Token，不要把 GitHub 或 Bangumi 密钥写进网页。

## 数据来源及限制

使用 Bangumi 公共 API：`POST /v0/search/subjects`（动画类型 2）和 `GET /v0/subjects/{id}`。搜索及读取新作品需要访问 api.bgm.tv，远程封面需要访问 lain.bgm.tv；跨域策略、网络及 API 限流可能影响使用。API 故障会显示提示，已经保存的文字资料仍可浏览。默认不搜索 NSFW 条目。

公开页面没有身份验证；访客的编辑只影响自己的浏览器，不能修改你的 GitHub 仓库。若希望直接在网页里保存到 GitHub、跨设备自动同步，需要后续增加安全的登录和写入服务。

Bangumi 官方 API 文档：https://bangumi.github.io/api/
