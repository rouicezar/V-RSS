<div align="center">
<img src="assets/logo.svg" width="90" alt="V-RSS Logo"/>

# V-RSS

微信公众号订阅、RSS 输出与本地文章库

[English](README.md) | **简体中文**

[项目背景](#项目背景与初衷) · [快速部署](#快速部署) · [首次使用](#首次使用) · [两种采集方案](#两种采集方案) · [配置](#配置) · [排错](#排错) · [致谢](#致谢)
</div>

V-RSS 将公众号文章同步到自己的 SQLite 数据库，提供 RSS/Atom/JSON Feed、全文缓存、图片本地化、搜索收藏和可选 AI 分析。管理界面和 API 由同一个服务提供。

## 项目背景与初衷

现在，许多优质知识和实用教程分散在抖音、小红书、哔哩哔哩、微信公众号等相对封闭的内容生态中。我们通常只能在各个平台内观看、收藏和搜索；如果想把真正有价值的内容找出来，整理进自己的自进化知识库，继续检索、关联和学习，往往并不容易。

我做 V-RSS，是希望先解决微信公众号文章这条链路：找到自己愿意长期关注的创作者，在项目中订阅他们的公众号，持续、克制地同步文章，再将这些内容放进自己的自进化知识库，逐步补充相关领域的知识。它并不是为了追求一次性囤积大量文章，而是为了建立一条长期、可持续的学习路径。

V-RSS 目前仍是第一版，主要用于个人学习、技术交流和方法探索，难免存在不完善的地方。欢迎大家提出建议、反馈问题或参与改进；我也会根据实际使用情况持续更新。

微信公众号对批量、频繁拉取文章存在限流和账号风控。虽然项目已经加入请求间隔、配额、熔断和管线切换等保护机制，但这些措施不能消除风险。请不要短时间大批量采集，否则可能导致账号被限制，甚至存在封号风险。文章拉得再多，也不等于能一次学完；保持节制、细水长流，才是更稳妥的使用方式。

最后，请尊重每一位作者的劳动和版权。同步的文章应以个人学习、研究和交流为目的，请勿未经授权直接搬运、洗稿、转载或用于商业传播。工具帮助我们更好地学习内容，不代表我们拥有内容本身。

> 本项目不能消除微信平台的限流。它提供保守节流、持久化熔断和两条可手动切换的采集管线。请仅在合法授权和个人合理使用范围内运行。

## 功能

- 方案1：使用 `.xyz` 微信读书中转服务采集。
- 方案2：使用本项目自有的微信公众号后台管线采集。
- 当前方案、限流计数和熔断时间跨重启保留；任务执行中禁止切换方案。
- 账号与方案永久绑定，列表、编辑、删除和采集都不会跨方案取账号。
- RSS、Atom、JSON Feed，全量或单公众号输出。
- 文章正文入库、微信图片本地化、搜索、收藏、标签。
- 可选 DeepSeek 标签、分析报告和学习计划。

## 快速部署

### Docker Compose（推荐）

要求：Docker Engine 20.10+，Docker Compose v2。

```bash
git clone https://github.com/rouicezar/V-RSS.git
cd V-RSS
cp .env.example .env
openssl rand -hex 32
```

编辑根目录 `.env`：

```dotenv
AUTH_CODE=设置一个至少12位的管理授权码
ENCRYPTION_KEY=粘贴上一步生成的随机字符串
SERVER_ORIGIN_URL=http://localhost:4000
PLATFORM_URL=https://weread.111965.xyz
```

然后启动：

```bash
docker compose up -d --build
docker compose logs -f app
```

日志出现 `Server is running` 后访问 <http://localhost:4000/dash>。SQLite 和图片保存在根目录 `data/`，重建容器不会丢失。

### 本地 Node.js

要求：Node.js 22+，pnpm 9+（任意较新版本即可，可用 `corepack enable` 启用，或 `npm i -g pnpm@latest` 安装最新版），macOS 或 Linux。

```bash
git clone https://github.com/rouicezar/V-RSS.git
cd V-RSS
cp apps/server/.env.example apps/server/.env
openssl rand -hex 32
```

在 `apps/server/.env` 填写 `AUTH_CODE`（至少 12 位）和 `ENCRYPTION_KEY`（至少 32 位），然后：

```bash
./start.sh
```

脚本会安装锁定版本依赖（升级后重跑同一命令也会增量校验同步依赖）、生成 Prisma Client、迁移数据库、重新构建前后端并启动服务。升级后仍运行同一命令即可。

## 首次使用

1. 打开 `/dash`，输入 `.env` 中的 `AUTH_CODE`。
2. 在“公众号源”选择方案1或方案2。
3. 切到“账号管理”，在当前方案下扫码。账号会自动绑定当前方案。
4. 回到“公众号源”：方案1粘贴一篇公众号文章链接；方案2搜索公众号名称并选择。
5. 添加后同步文章。需要 RSS 时复制页面中的订阅地址。

不要先在一个方案扫码、再切换到另一个方案使用该账号。界面只展示当前方案账号，服务端也强制校验归属；切换后若显示“无可用账号”，请在新方案下扫码。

## 两种采集方案

| 项目       | 方案1                                        | 方案2                                    |
| ---------- | -------------------------------------------- | ---------------------------------------- |
| 数据链路   | `PLATFORM_URL` 指向的 `.xyz` 服务            | 本项目直连微信公众号后台                 |
| 登录       | 微信读书扫码                                 | 公众号后台扫码                           |
| 添加公众号 | 粘贴公众号文章链接                           | 搜索公众号名称                           |
| 限流处理   | 401 令账号失效；429 当日隔离该账号并换号重试 | 请求间隔、日配额、分级熔断与 24 小时恢复 |
| 账号归属   | 仅方案1                                      | 仅方案2                                  |

方案1依赖第三方服务，仓库维护者无法保证其可用性、接口兼容性或数据处理政策。对稳定性和隐私要求更高时优先使用方案2；方案2仍受微信官方接口风控约束。

切换规则：

- 切换只影响后续请求，不会把已有账号改绑。
- 全量同步或历史同步运行时拒绝切换。
- 方案1未配置 `PLATFORM_URL` 时拒绝切入。
- 当前管线限流时不会偷偷改用另一管线，必须由用户明确切换。

详细状态机见 [管线切换设计](docs/pipeline-switch-design.md) 和 [测试记录](docs/pipeline-switch-testing.md)。

## 配置

本地部署使用 `apps/server/.env`；Docker 使用根目录 `.env`。当前发布版只正式支持 SQLite。

| 变量                     | 必填      | 默认值                  | 说明                                                    |
| ------------------------ | --------- | ----------------------- | ------------------------------------------------------- |
| `AUTH_CODE`              | 生产必填  | 无                      | 管理界面/API 授权码，至少 12 位                         |
| `ENCRYPTION_KEY`         | 生产必填  | 无                      | token 加密密钥，至少 32 位；修改后历史 token 需重新扫码 |
| `SERVER_ORIGIN_URL`      | 建议      | `http://localhost:4000` | 对外地址和生产 CORS 来源，不带末尾 `/`                  |
| `PLATFORM_URL`           | 方案1必填 | `.env.example` 中示例   | 方案1 `.xyz` 服务基地址                                 |
| `DATABASE_URL`           | 否        | `file:../data/vrss.db`  | SQLite 文件位置                                         |
| `PORT` / `HOST`          | 否        | `4000` / `0.0.0.0`      | 监听端口和地址                                          |
| `CRON_EXPRESSION`        | 否        | `35 5,17 * * *`         | 自动同步 Cron                                           |
| `UPDATE_DELAY_TIME`      | 否        | `60`                    | 连续更新间隔（秒）                                      |
| `MAX_REQUEST_PER_MINUTE` | 否        | `60`                    | 管理接口/保护参数                                       |
| `FEED_MODE`              | 否        | `fulltext`              | RSS 正文模式                                            |
| `ENABLE_CLEAN_HTML`      | 否        | `true`                  | 清理正文 HTML                                           |
| `DEEPSEEK_API_KEY`       | 否        | 空                      | 仅 AI 功能需要                                          |

生产环境会拒绝空、过短或常见默认 `AUTH_CODE`，也会拒绝少于 32 位的 `ENCRYPTION_KEY`。请把服务置于 HTTPS 反向代理后，不要公开 `.env`、数据库或 `data/`。

## RSS 地址

```text
http://你的地址:4000/feeds/all.rss
http://你的地址:4000/feeds/all.atom
http://你的地址:4000/feeds/all.json
http://你的地址:4000/feeds/公众号ID.rss
```

## 运维

升级 Docker：

```bash
git pull
docker compose up -d --build
```

升级本地部署：

```bash
git pull
./start.sh
```

备份前可短暂停止服务，再复制整个 `data/`（Docker）或 `apps/server/data/`（本地）。恢复时把目录放回原位后启动；数据库迁移会自动执行。

健康检查：访问 `/` 应返回项目版本信息，访问 `/dash` 应显示登录页。查看 Docker 状态使用：

```bash
docker compose ps
docker compose logs --tail=200 app
```

## 排错

### `No "query"-procedure on path "platform.pipeline"`

前端已更新但后端仍是旧构建。执行 `git pull && ./start.sh`，或 `git pull && docker compose up -d --build`。不要只重启旧容器或旧 `dist`。

### 方案1同步返回 401

该方案1微信读书 token 已失效。V-RSS 会把对应账号标为失效，不会借用方案2账号。保持方案1，在“账号管理”重新扫码；或者明确切换方案2并使用方案2自己的账号。

### 请求失败 / 429 / 进入限流

停止反复点击同步。方案1会隔离当天受限账号；方案2会持久化熔断，重启不会清除。可等待页面倒计时结束，或切换到已有独立可用账号的另一方案。频繁重启、删状态库或提高请求频率只会增加风险。

### 方案2搜不到公众号

确认当前是方案2、账号管理中存在启用的方案2账号，并重新扫码公众号后台。部分账号权限、登录状态或微信风控会限制搜索结果。

### 页面能打开但登录循环

确认访问地址与 `SERVER_ORIGIN_URL` 完全一致（协议、域名、端口），清理该站点 localStorage 后重新输入授权码。反向代理必须转发 `/dash`、`/trpc`、`/feeds` 和 `/img`。

### AI 功能不可用

公众号采集不依赖 AI。只有标签、分析和学习计划需要有效的 `DEEPSEEK_API_KEY`。

## 开发验证

```bash
pnpm install --frozen-lockfile
pnpm --filter vrss-server test
pnpm run -r build
pnpm fmt.check
```

发布验收标准与记录见 [requirements](docs/open-source-release-requirements.md)、[design](docs/open-source-release-design.md) 和 `docs/open-source-release-testing.md`。

## 安全与边界

- token 使用 AES-256-GCM 加密存储，账号 API 不返回 token。
- 文章和图片抓取限制在预期微信 HTTPS 域名；管理 API 需要授权码。
- 项目是个人自托管工具，不是多租户 SaaS。所有登录用户共享同一实例数据。
- 微信、微信读书及第三方 `.xyz` 服务均可能改变接口；无法承诺永久可用。
- 使用者需自行遵守服务条款、著作权、隐私和当地法律，不得用于批量滥用。

## 致谢

特别感谢 [weread.111965.xyz](https://weread.111965.xyz) 服务的开发者与维护者。该服务为 V-RSS 的方案1提供了重要的微信公众号文章采集能力，使这条管线得以实现，也为本项目的学习、研究和交流提供了宝贵支持。

`weread.111965.xyz` 是由第三方独立提供和维护的服务，并非 V-RSS 官方服务。请大家在使用时尊重服务提供者的劳动与使用规则，控制请求频率，不要滥用，也不要将其稳定性视为理所当然。

## License

[MIT](LICENSE)
