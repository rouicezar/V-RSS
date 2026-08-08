# V-RSS Docker 镜像（SQLite 单模式，个人使用推荐）
FROM node:22.18.0-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache openssl && npm install --global pnpm@10.33.0

FROM base AS build
COPY . /usr/src/app
WORKDIR /usr/src/app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run -r build
# 部署 server（含依赖与 dist）
RUN pnpm --filter vrss-server deploy --legacy --prod /app
RUN cp -R apps/server/dist /app/dist && cp -R apps/server/client /app/client

FROM base
COPY --from=build /app /app
WORKDIR /app
EXPOSE 4000

ENV NODE_ENV=production
ENV HOST="0.0.0.0"
ENV SERVER_ORIGIN_URL=""
ENV MAX_REQUEST_PER_MINUTE=60
ENV DATABASE_URL="file:../data/vrss.db"
ENV DATABASE_TYPE="sqlite"
ENV ENABLE_CLEAN_HTML="true"
ENV FEED_MODE="fulltext"

# 生成 prisma client 并运行数据库迁移
RUN npx prisma generate && chmod +x ./docker-bootstrap.sh

CMD ["./docker-bootstrap.sh"]
