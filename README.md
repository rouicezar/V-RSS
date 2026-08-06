<div align="center">
<img src="assets/logo.svg" width="90" alt="V-RSS Logo"/>

# V-RSS · 微信公众号订阅与知识分析

**把公众号变成你的个人知识库：自动订阅 → 正文入库 → AI 打标 → 雷达分析 → 学习计划**

[功能特性](#-功能特性) • [界面预览](#-界面预览) • [快速开始](#-快速开始) • [使用方法](#-使用方法) • [配置说明](#-配置说明) • [常见问题](#-常见问题)

</div>

---

## 💡 这个项目能做什么？

很多人关注的公众号文章看完就没了，很难再找到、更别说系统化学习。V-RSS 把这条链路打通：

```
关注公众号 → 微信读书扫码授权
    ↓ 自动采集文章（含正文全文、图片本地化）
文章知识库（可搜索 / 筛选 / 收藏 / 打标签）
    ↓ AI 标签 + 领域归因（DeepSeek）
关注雷达分析 → 能力图谱 / 强弱项洞察
    ↓
AI 学习计划（4 周学习路径，基于你的薄弱领域）
```

同时保留了经典的 **RSS 订阅**能力，你可以在任何 RSS 阅读器里订阅公众号。

---

## ✨ 功能特性

### 📥 公众号订阅
- 微信扫码登录公众号后台，官方接口直连采集文章列表与历史文章
- 后台定时自动同步更新（默认每天 5:35 / 17:35）
- 标准 RSS 输出（`.rss` / `.atom` / `.json`），支持全文/摘要模式
- 所有订阅源一键导出 OPML

### 📚 文章知识库
- **正文全文入库**，图片自动下载本地化（解决微信防盗链）
- 关键词搜索（标题/正文）、按公众号/标签/收藏/日期筛选
- 收藏 + 批注，构建你的私人精选集
- 一键批量补全缺失正文

### 🤖 AI 分析（DeepSeek）
- **自动打标签**：AI 理解文章内容，提取 3-5 个精准标签 + 领域归因
- **关注雷达**：基于收藏权重和阅读量，生成多维度能力雷达图
- **分析报告**：关注结构、强弱项、交叉洞察、行动建议
- **学习计划**：针对薄弱领域生成 4 周循序渐进的学习路径

### 🎨 其他
- 前后端分离，现代化 UI（React + Tailwind + NextUI），明暗主题
- 用户认证（访问授权码）
- 完整的 REST/tRPC API

---

## 🖼️ 界面预览

| 公众号源 | 文章库 | 知识分析 |
|:---:|:---:|:---:|
| ![公众号源](assets/preview-feeds.svg) | ![文章库](assets/preview-library.svg) | ![知识分析](assets/preview-analysis.svg) |


---

## 🚀 快速开始

### 方式一：Docker Compose（推荐，最简单）

**环境要求**：Docker 20.10+ / Docker Compose v2

```bash
# 1. 拉取代码
git clone https://github.com/rouicezar/V-RSS.git
cd V-RSS

# 2. 修改配置（必改：AUTH_CODE 密码；可选：DEEPSEEK_API_KEY）
vim docker-compose.yml

# 3. 一键启动（首次构建约 5-10 分钟）
docker compose up -d --build

# 4. 查看日志
docker compose logs -f app
```

启动后访问：**http://localhost:4000/dash**

### 方式二：本地部署（Linux / macOS）

**环境要求**：Node.js 20+、pnpm（自动安装）

```bash
# 1. 拉取代码
git clone https://github.com/rouicezar/V-RSS.git
cd V-RSS

# 2. 一键安装并启动（自动装依赖/初始化数据库/构建/启动）
./start.sh

# 3. 修改 AuthCode 密码（可选但建议）
#    编辑 apps/server/.env 中的 AUTH_CODE
#    重启 ./start.sh restart
```

### 方式三：手动部署

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp apps/server/.env.example apps/server/.env
vim apps/server/.env          # 修改 AUTH_CODE 和 DEEPSEEK_API_KEY

# 初始化数据库（SQLite 自动建库）
cd apps/server && npx prisma migrate deploy && cd ..

# 构建前后端
pnpm run -r build
cp -r apps/server/client apps/server/dist/client

# 启动
cd apps/server && node dist/main
```

---

## 📱 使用方法

### 第 1 步：扫码授权微信读书

打开 `http://localhost:4000/dash` → **账号管理** → **添加读书账号** → 微信扫码登录微信读书。

> ⚠️ **重要：登录时不要勾选"24小时后自动退出"**，否则 token 会失效需要重新登录。

### 第 2 步：订阅公众号

进入 **公众号源** → **添加** → 粘贴公众号文章的分享链接（形如 `https://mp.weixin.qq.com/s/xxxx`）→ 自动抓取历史文章。

> ⚠️ 添加频率过高容易被微信读书封控（小黑屋），建议一次添加不超过 5 个，间隔一段时间再加。

### 第 3 步：文章入库与打标

- **文章库** 页面：查看已入库文章，点"补全正文"批量抓取正文全文（含图片）
- 点 **AI 批量打标**：用 DeepSeek 自动给文章打标签、归因领域
- 遇到好文章点 **收藏**（收藏会影响雷达分析权重）

### 第 4 步：雷达分析与学习计划

进入 **分析** 页面：
1. **关注雷达**：查看你的关注领域分布（先"更新"）
2. **分析报告**：点"生成分析报告"，获得关注结构/强弱项/行动建议
3. **学习计划**：点"生成 4 周学习计划"，基于薄弱领域生成学习路径

### 额外：RSS 订阅

```
# 全部文章
http://your-host:4000/feeds/all.rss
# 单个公众号（MP_WXS_xxx 为公众号 ID，可在文章库 URL 中看到）
http://your-host:4000/feeds/MP_WXS_xxx.rss
```

支持 `.rss` / `.atom` / `.json` 三种格式，可用任何 RSS 阅读器订阅。

---

## ⚙️ 配置说明

所有配置通过 `apps/server/.env`（本地）或 docker-compose 环境变量（Docker）设置：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `PORT` | 服务端口 | `4000` |
| `AUTH_CODE` | 管理界面访问授权码（**必须修改**） | `changeme` |
| `DATABASE_TYPE` | 数据库类型 | `sqlite` |
| `DATABASE_URL` | 数据库连接（SQLite 无需改） | `file:../data/vrss.db` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（AI 功能，[获取](https://platform.deepseek.com)） | 空 |
| `SERVER_ORIGIN_URL` | 公网部署时填域名，用于生成完整 RSS 链接 | `http://localhost:4000` |
| `CRON_EXPRESSION` | 定时同步 Cron 表达式 | `35 5,17 * * *` |
| `FEED_MODE` | RSS 全文模式 | `fulltext` |
| `MAX_REQUEST_PER_MINUTE` | 每分钟最大请求数（防封控） | `60` |
| `UPDATE_DELAY_TIME` | 连续更新延迟秒数 | `60` |

**支持 MySQL**：把 `DATABASE_TYPE` 改为 `mysql` 并设置 `DATABASE_URL`（如 `mysql://root:pass@host:3306/vrss`），首次启动前需将 `apps/server/prisma/schema.prisma` 的 datasource provider 改为 `mysql` 并重新 `npx prisma migrate dev`。个人使用建议保持 SQLite。

---

## 🔧 技术栈

**后端**：NestJS · Prisma · tRPC · SQLite/MySQL · APScheduler（定时任务）
**前端**：React 18 · TypeScript · Vite · Tailwind CSS · NextUI · lucide-react
**AI**：DeepSeek（文章打标 / 雷达分析 / 学习计划）
**采集**：微信读书接口 + 微信文章公开页抓取（图片本地化）

---

## ❓ 常见问题

**Q1：为什么有些文章没有正文？**
微信侧部分文章链接已失效（作者删除或平台清理），无法获取，界面会标注"链接失效"。

**Q2：添加公众号时提示频繁/被小黑屋？**
微信读书对添加频率有限制，等 24 小时恢复；可通过重启容器清除小黑屋记录。

**Q3：AI 打标/分析不可用？**
需要在 `DEEPSEEK_API_KEY` 配置有效的 DeepSeek API Key（其余功能不受影响）。

**Q4：图片显示不了？**
V-RSS 会把文章图片下载到本地（`data/images`），正常情况下不会防盗链。若个别图片缺失，可重新抓取正文。

**Q5：如何升级？**
```bash
# 本地
git pull && ./start.sh restart
# Docker
git pull && docker compose up -d --build
```

**Q6：数据存在哪里？**
SQLite 数据库和抓取的图片都在 `data/` 目录（Docker 挂载 `./data:/app/data`）。备份时打包该目录即可。

---

## ⚠️ 免责声明

- 本项目仅用于个人学习与研究，请遵守微信读书与微信公众号平台的相关协议
- 采集频率过高可能导致微信读书账号被临时限制，请合理使用
- 本项目不存储任何用户的账号密码，仅保存登录 token 用于数据采集

---

## 📄 License

[MIT](./LICENSE)


---

<div align="center">

**如果这个项目对你有帮助，请点个 ⭐ Star 支持一下！**

</div>
