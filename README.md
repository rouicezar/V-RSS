<div align="center">
<img src="assets/logo.svg" width="90" alt="V-RSS Logo"/>

# V-RSS

WeChat Official Account subscriptions, RSS feeds, and a local article library

**English** | [简体中文](README.zh-CN.md)

[Background](#background-and-motivation) · [Quick Start](#quick-start) · [First Use](#first-use) · [Pipelines](#collection-pipelines) · [Configuration](#configuration) · [Troubleshooting](#troubleshooting) · [Acknowledgements](#acknowledgements)
</div>

V-RSS syncs articles from WeChat Official Accounts into your own SQLite database. It provides RSS, Atom, and JSON Feed output, full-text caching, local image storage, search, favorites, and optional AI-assisted analysis. The web dashboard and API are served by a single application.

## Background and Motivation

Much of today's high-quality knowledge and practical educational content lives inside relatively closed platforms such as Douyin, Xiaohongshu, Bilibili, and WeChat Official Accounts. Content can usually be viewed, saved, and searched only within its original platform. Extracting the genuinely valuable material and bringing it into a self-evolving knowledge base for continued search, connection, and learning is still unnecessarily difficult.

I built V-RSS to address the WeChat article part of this problem first: find creators worth following over the long term, subscribe to their official accounts, sync their articles steadily and responsibly, and bring that material into a self-evolving knowledge base. The goal is not to hoard thousands of articles at once, but to establish a sustainable learning workflow that gradually strengthens your knowledge in the fields you care about.

V-RSS is currently a first release intended for personal learning, technical exchange, and experimentation. It will inevitably have rough edges. Suggestions, issue reports, and contributions are welcome, and I plan to keep improving it based on real-world use.

WeChat applies rate limits and account-level risk controls to bulk or frequent article requests. V-RSS includes request spacing, quotas, circuit breakers, and manual pipeline switching, but these safeguards cannot eliminate the risk. Do not collect large batches in a short period: your account may be restricted or even banned. More saved articles do not automatically mean more learning. A restrained, steady approach is safer and more useful.

Please respect every author's work and copyright. Synced articles should be used for personal learning, research, and discussion. Do not republish, rewrite, redistribute, or commercially exploit an author's work without permission. A tool that helps you study content does not give you ownership of that content.

> V-RSS cannot remove platform rate limits. Use it responsibly, within the permissions granted to you, and in compliance with applicable laws and platform terms.

## Features

- Two manually switchable collection pipelines.
- Pipeline 1 uses the configured `.xyz` WeRead relay service.
- Pipeline 2 uses V-RSS's own WeChat Official Account backend integration.
- The active pipeline, rate-limit counters, and circuit-breaker state survive restarts.
- Accounts are permanently bound to their pipeline; account reads and collection jobs never cross pipeline boundaries.
- RSS, Atom, and JSON Feed output for all articles or an individual official account.
- Full article storage, local WeChat image caching, search, favorites, and tags.
- Optional DeepSeek-powered tagging, reports, and learning plans.

## Quick Start

### Docker Compose (recommended)

Requirements: Docker Engine 20.10+ and Docker Compose v2.

```bash
git clone https://github.com/rouicezar/V-RSS.git
cd V-RSS
cp .env.example .env
openssl rand -hex 32
```

Edit `.env` in the repository root:

```dotenv
AUTH_CODE=choose-an-admin-code-of-at-least-12-characters
ENCRYPTION_KEY=paste-the-random-value-generated-above
SERVER_ORIGIN_URL=http://localhost:4000
PLATFORM_URL=https://weread.111965.xyz
```

Start the service:

```bash
docker compose up -d --build
docker compose logs -f app
```

When the logs show `Server is running`, open <http://localhost:4000/dash>. SQLite data and downloaded images are stored in `data/` and survive container rebuilds.

### Local Node.js Deployment

Requirements: Node.js 22+, macOS or Linux.

```bash
git clone https://github.com/rouicezar/V-RSS.git
cd V-RSS
cp apps/server/.env.example apps/server/.env
openssl rand -hex 32
```

Set `AUTH_CODE` (at least 12 characters) and `ENCRYPTION_KEY` (at least 32 characters) in `apps/server/.env`, then run:

```bash
./start.sh
```

The script installs locked dependencies, generates the Prisma client, applies database migrations, rebuilds the frontend and backend, and starts the server. Run the same command again after upgrading.

## First Use

1. Open `/dash` and enter the `AUTH_CODE` from your environment file.
2. Choose Pipeline 1 or Pipeline 2 on the Official Accounts page.
3. Open Account Management and scan the QR code while the intended pipeline is active. The account is automatically bound to that pipeline.
4. Return to Official Accounts. For Pipeline 1, paste a WeChat article URL. For Pipeline 2, search for an official account by name.
5. Add the account and sync its articles. Copy the feed URL when you need RSS output.

Do not sign in under one pipeline and expect that account to work after switching to the other. The dashboard only lists accounts belonging to the active pipeline, and the backend enforces the same boundary. If the new pipeline reports that no account is available, sign in again while that pipeline is selected.

## Collection Pipelines

| Item                | Pipeline 1                                                                                    | Pipeline 2                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Data path           | `.xyz` service configured by `PLATFORM_URL`                                                   | Direct WeChat Official Account backend integration                                 |
| Sign-in             | WeRead QR code                                                                                | Official Account backend QR code                                                   |
| Add a source        | Paste a WeChat article URL                                                                    | Search by official account name                                                    |
| Rate-limit handling | A 401 invalidates the account; a 429 isolates it for the day and retries with another account | Request spacing, daily quotas, circuit breakers, and a 24-hour risk-control window |
| Account ownership   | Pipeline 1 only                                                                               | Pipeline 2 only                                                                    |

Pipeline 1 depends on an independent third-party service. The V-RSS maintainers cannot guarantee its uptime, compatibility, or data-handling policies. Pipeline 2 provides more control but remains subject to WeChat's official risk controls.

Switching rules:

- Switching affects subsequent requests only and never reassigns existing accounts.
- Switching is rejected while a full or historical sync is running.
- Pipeline 1 cannot be selected when `PLATFORM_URL` is not configured.
- V-RSS never silently falls back to the other pipeline. A user must explicitly switch pipelines.

See the [pipeline design](docs/pipeline-switch-design.md) and [test record](docs/pipeline-switch-testing.md) for implementation details.

## Configuration

Local deployments use `apps/server/.env`; Docker Compose uses `.env` in the repository root. This release officially supports SQLite only.

| Variable                 | Required    | Default                   | Description                                                                                 |
| ------------------------ | ----------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `AUTH_CODE`              | Production  | None                      | Dashboard/API access code; at least 12 characters                                           |
| `ENCRYPTION_KEY`         | Production  | None                      | Account-token encryption key; at least 32 characters. Changing it requires signing in again |
| `SERVER_ORIGIN_URL`      | Recommended | `http://localhost:4000`   | Public URL and production CORS origin, without a trailing slash                             |
| `PLATFORM_URL`           | Pipeline 1  | Example in `.env.example` | Base URL of the Pipeline 1 `.xyz` service                                                   |
| `DATABASE_URL`           | No          | `file:../data/vrss.db`    | SQLite database path                                                                        |
| `PORT` / `HOST`          | No          | `4000` / `0.0.0.0`        | Listening port and address                                                                  |
| `CRON_EXPRESSION`        | No          | `35 5,17 * * *`           | Scheduled sync expression                                                                   |
| `UPDATE_DELAY_TIME`      | No          | `60`                      | Delay between consecutive updates, in seconds                                               |
| `MAX_REQUEST_PER_MINUTE` | No          | `60`                      | Management/API protection setting                                                           |
| `FEED_MODE`              | No          | `fulltext`                | RSS content mode                                                                            |
| `ENABLE_CLEAN_HTML`      | No          | `true`                    | Clean article HTML                                                                          |
| `DEEPSEEK_API_KEY`       | No          | Empty                     | Required only for AI features                                                               |

Production startup rejects empty, short, or common default values for `AUTH_CODE`, and rejects an `ENCRYPTION_KEY` shorter than 32 characters. Put public deployments behind an HTTPS reverse proxy. Never expose `.env`, the SQLite database, or the `data/` directory.

## Feed URLs

```text
http://your-host:4000/feeds/all.rss
http://your-host:4000/feeds/all.atom
http://your-host:4000/feeds/all.json
http://your-host:4000/feeds/OFFICIAL_ACCOUNT_ID.rss
```

## Operations

Upgrade a Docker deployment:

```bash
git pull
docker compose up -d --build
```

Upgrade a local deployment:

```bash
git pull
./start.sh
```

Before creating a backup, stop the service if practical and copy the entire `data/` directory for Docker, or `apps/server/data/` for a local deployment. Restore the directory to the same location before starting the service; migrations are applied automatically.

For a basic health check, `/` should return the project entry page and `/dash` should render the sign-in page. For Docker:

```bash
docker compose ps
docker compose logs --tail=200 app
```

## Troubleshooting

### `No "query"-procedure on path "platform.pipeline"`

The frontend is newer than the running backend. Run `git pull && ./start.sh`, or `git pull && docker compose up -d --build`. Restarting an old container or stale `dist` directory is not sufficient.

### Pipeline 1 returns HTTP 401 during sync

The Pipeline 1 WeRead token has expired. V-RSS marks that account invalid and will not borrow a Pipeline 2 account. Keep Pipeline 1 selected and scan the QR code again in Account Management, or explicitly switch to Pipeline 2 and use an account that belongs to Pipeline 2.

### Request failed, HTTP 429, or rate limit active

Stop repeatedly triggering sync. Pipeline 1 isolates a limited account for the day; Pipeline 2 persists its circuit-breaker state, so restarting does not clear it. Wait for the countdown to finish, or switch to the other pipeline only if it has its own available account. Repeated restarts, deleting state, or increasing request frequency makes the risk worse.

### Pipeline 2 cannot find an official account

Confirm that Pipeline 2 is active and that Account Management shows an enabled Pipeline 2 account. Sign in to the Official Account backend again if needed. Account permissions, session state, and WeChat risk controls may affect search results.

### The dashboard opens but keeps returning to sign-in

Make sure the address you visit exactly matches `SERVER_ORIGIN_URL`, including protocol, hostname, and port. Clear local storage for the site and sign in again. A reverse proxy must forward `/dash`, `/trpc`, `/feeds`, and `/img`.

### AI features are unavailable

Article collection does not require AI. Only tagging, analysis, and learning-plan features require a valid `DEEPSEEK_API_KEY`.

## Development Verification

```bash
pnpm install --frozen-lockfile
pnpm --filter vrss-server test
pnpm run -r build
pnpm fmt.check
```

Release criteria and evidence are documented in [requirements](docs/open-source-release-requirements.md), [design](docs/open-source-release-design.md), and [testing](docs/open-source-release-testing.md).

## Security and Boundaries

- Account tokens are encrypted at rest with AES-256-GCM and are never returned by the account API.
- Article and image fetching is restricted to expected WeChat HTTPS hosts; the management API requires an access code.
- V-RSS is a personal self-hosted application, not a multi-tenant SaaS platform. Every signed-in user shares the same instance data.
- WeChat, WeRead, and the third-party `.xyz` service may change their interfaces at any time. Permanent availability cannot be guaranteed.
- Operators are responsible for complying with service terms, copyright, privacy requirements, and applicable laws. Do not use V-RSS for bulk abuse.

## Acknowledgements

Special thanks to the developers and maintainers of [weread.111965.xyz](https://weread.111965.xyz). Their service provides the essential WeChat article collection capability behind Pipeline 1 and has made this learning and research project possible.

`weread.111965.xyz` is an independently operated third-party service, not an official V-RSS service. Please respect its maintainers and usage rules, keep request rates reasonable, do not abuse it, and never take its continued availability for granted.

## License

[MIT](LICENSE)
