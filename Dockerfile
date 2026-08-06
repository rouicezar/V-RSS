# V-RSS Docker 镜像（SQLite 单模式，个人使用推荐）
FROM node:20.16.0-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm i -g pnpm

FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile || pnpm install
RUN pnpm run -r build
# 前端产物拷入 server 运行目录
RUN cp -r apps/server/client apps/server/dist/client
# 部署 server（含依赖与 dist）
RUN pnpm deploy --filter=server --prod /app

FROM base
COPY --from=build /app /app
WORKDIR /app
EXPOSE 4000

ENV NODE_ENV=production
ENV HOST="0.0.0.0"
ENV SERVER_ORIGIN_URL=""
ENV MAX_REQUEST_PER_MINUTE=60
ENV AUTH_CODE=""
ENV DATABASE_URL="file:../data/vrss.db"
ENV DATABASE_TYPE="sqlite"
ENV ENABLE_CLEAN_HTML="true"
ENV FEED_MODE="fulltext"

# 生成 prisma client 并运行数据库迁移
RUN npx prisma generate
RUN chmod +x ./docker-bootstrap.sh

CMD ["./docker-bootstrap.sh"]
