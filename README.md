# Anime Shelf · 我的动画手账

记录收藏动画的个人静态网站，作品资料来自 Bangumi，适配电脑与手机。无需构建、无需安装依赖，已部署到 GitHub Pages。

**在线访问：[Anime Shelf](https://doublename02.github.io/AnimeList/)**

## 功能

- 按中文名或原名搜索 Bangumi 动画作品并添加到书架。
- 展示封面、中日文名称、制作公司、首播年份和季度。
- 编辑作品资料和个人短评，移除作品。
- 按名称或制作公司搜索收藏，按年份、季度筛选，按添加时间、放送时间或名称排序。
- 导入、导出 JSON 清单，支持当前浏览器本地保存。

网站不记录观看状态。

## 本地预览

在项目目录运行 `python -m http.server 4173`，然后访问 http://localhost:4173 。请通过 HTTP 打开，直接双击 HTML 无法加载 JSON。

## 使用

- 点击“添加作品”，输入中文名或原名搜索 Bangumi，点击收藏后确认资料。
- 记录封面、中日文名称、动画制作公司、首播年份和季度及短评。
- 季度按首播月份推算：1–3 月为冬季、4–6 月为春季、7–9 月为夏季、10–12 月为秋季。跨季度播出的作品仍归入首播季度。
- 制作公司优先取 Bangumi 的“动画制作”字段，资料缺失时可手动补充。
- 修改自动保存到当前浏览器的 localStorage；清除网站数据或换设备后，本地修改不会保留。
- “导出清单”下载完整的 `library.json`；用它替换仓库里的 `data/library.json` 并提交，重新部署后其他设备和访客即可看到。已有本地清单的浏览器会继续优先使用本地版本，可通过“导入清单”替换。
- 导入会替换当前清单，建议先导出备份。

初始数据从《刀剑神域》Obsidian 记录迁入，保留网站使用的封面。原 Obsidian 笔记、设置及插件已清理；后续通过网页维护清单。

## 更新清单并同步网站

目前尚未实现自动同步到 GitHub，也没有云端数据库。网页中的新增、修改及删除仅保存在操作时使用的浏览器中。

1. 在网页完成编辑后，点击“导出清单”，下载 `library.json`。
2. 将文件替换到本仓库的 `data/library.json` 并提交到 `main` 分支。
3. 等待 [GitHub Actions](https://github.com/doublename02/AnimeList/actions/workflows/pages.yml) 部署成功，公开网站即会更新。

首次访问的设备会读取仓库中的清单。已有本地清单的浏览器仍优先使用本地版本，需要通过“导入清单”导入最新 JSON。访客的编辑只影响自己的浏览器。

## 导入格式

接受 `.json` 文件，内容为作品数组。推荐直接使用网页导出的文件。`id` 是唯一的正整数 Bangumi 作品 ID，`title` 是非空作品名称，两项必填，其余字段可省略。

```json
[
  {
    "id": 23686,
    "title": "刀剑神域",
    "original": "ソードアート・オンライン",
    "cover": "https://lain.bgm.tv/pic/cover/l/2e/c8/23686_e36x9.jpg",
    "studio": "A-1 Pictures",
    "year": 2012,
    "season": "summer",
    "date": "2012-07-07",
    "note": "",
    "addedAt": "2026-10-18T02:38:00.000Z"
  }
]
```

`season` 可填 `winter`、`spring`、`summer`、`autumn`，或留空。封面支持 HTTPS 链接，或项目内 `AnimeList/Covers/` 下的相对路径；使用本地封面时，图片也需提交到仓库。导入文件最大 10 MB，最多 10000 部作品，ID 不能重复。旧清单中的观看状态字段会在读取时移除。

## 部署说明

本仓库已启用 GitHub Pages，使用 `.github/workflows/pages.yml` 发布。提交到 `main` 分支会自动部署，也可以在 Actions 页面手动运行 **Deploy GitHub Pages**。

如需部署到其他仓库：

1. 在 GitHub 创建仓库，把本目录文件上传到仓库的 `main` 分支，包含隐藏目录 `.github`。
2. 打开仓库 **Settings → Pages → Build and deployment**，Source 选择 **GitHub Actions**。
3. 打开 **Actions → Deploy GitHub Pages → Run workflow**（后续提交到 main 会自动部署）。
4. 等待成功后，打开部署结果中的网址，一般是 `https://你的用户名.github.io/仓库名/`。

部署仅打包网页、JSON 和封面。若仓库本身公开，仓库内所有已提交文件仍可被访问。无需 Token，不要把 GitHub 或 Bangumi 密钥写进网页。

## 数据来源及限制

使用 Bangumi 公共 API：`POST /v0/search/subjects`（动画类型 2）和 `GET /v0/subjects/{id}`。搜索及读取新作品需要访问 api.bgm.tv，远程封面需要访问 lain.bgm.tv；跨域策略、网络及 API 限流可能影响使用。API 故障会显示提示，已经保存的文字资料仍可浏览。默认不搜索 NSFW 条目。

公开页面没有身份验证；访客的编辑只影响自己的浏览器，不能修改你的 GitHub 仓库。若希望直接在网页里保存到 GitHub、跨设备自动同步，需要后续增加安全的登录和写入服务。

Bangumi 官方 API 文档：[bangumi.github.io/api](https://bangumi.github.io/api/)
