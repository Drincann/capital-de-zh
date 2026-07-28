# 《资本论》第一卷：线上预览

这是独立于本地翻译控制台的公开阅读应用。构建时，它只导出翻译项目中已经采用的版本，不包含草稿、审核记录和任务状态。

## 页面

- `/`：公开阅读页
- `/analytics`：仅站点所有者可访问的 UV/PV 统计页

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
copy .env.example .env.local
npm run dev
```

默认从相邻目录 `../outputs/capital-volume1-de-zh-new` 读取正式采用记录。也可以通过 `CAPITAL_PROJECT_ROOT` 指定其他翻译工程目录。

## 发布内容

```bash
npm run export:release
```

导出结果：

- `generated/release-manifest.json`：公开目录
- `public/content/*.json`：各小节的已采用正文

线上构建环境找不到本地翻译工程时，会使用仓库中已经提交的发布快照。

## 匿名统计

运行环境需要配置：

- `ANALYTICS_ID_SECRET`：用于生成匿名访客 ID 和不可逆摘要的随机密钥
- `ANALYTICS_OWNER_EMAIL`：允许访问 `/analytics` 的 ChatGPT 登录邮箱

身份识别以第一方随机 Cookie 为主。浏览器环境指纹只在 Cookie 丢失时辅助找回原有匿名 ID；服务器只保存其 HMAC 摘要，不保存原始指纹、IP、User-Agent、来源页、访问路径或单次访问明细。

持久化数据只有：

- 匿名访客总量
- 每日 UV
- 每日 PV
- 用于去重的每日匿名访客集合
- 限时保留的匿名恢复映射和限流摘要

数据库结构在 `db/schema.ts`，迁移文件在 `drizzle/`。
