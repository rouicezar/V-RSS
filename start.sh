#!/bin/bash
# ============================================================
# V-RSS 一键安装 & 启动脚本（本地部署）
# 适用：Linux / macOS（Windows 请使用 Docker 方式）
#
# 用法：
#   ./start.sh          # 首次运行自动安装依赖并启动
#   ./start.sh restart  # 强制重新构建后启动
# ============================================================
set -e

cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}┌─────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│            V-RSS 启动器                 │${NC}"
echo -e "${BLUE}└─────────────────────────────────────────┘${NC}"

# ---------- 1. 环境检查 ----------
command -v node >/dev/null 2>&1 || { echo -e "${RED}❌ 未安装 Node.js（需要 22+）${NC}"; echo "  安装: https://nodejs.org 或 brew install node"; exit 1; }
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then echo -e "${RED}❌ Node 版本过低: $(node -v)，需要 22+${NC}"; exit 1; fi
echo -e "${GREEN}✅ Node: $(node -v)${NC}"

if command -v pnpm >/dev/null 2>&1; then
  echo -e "${GREEN}✅ pnpm: $(pnpm -v)${NC}"
else
  echo -e "${YELLOW}📦 安装 pnpm...${NC}"
  npm i -g pnpm
fi

# ---------- 2. 环境变量 ----------
ENV_FILE="apps/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp apps/server/.env.example "$ENV_FILE"
  echo -e "${YELLOW}📝 已生成配置: apps/server/.env（请修改 AUTH_CODE 密码）${NC}"
fi

# ---------- 3. 安装依赖 ----------
if [ ! -d "node_modules" ]; then
  echo -e "${BLUE}📦 安装依赖（首次较慢，请耐心等待）...${NC}"
  pnpm install --frozen-lockfile || { echo -e "${RED}❌ 依赖安装失败${NC}"; exit 1; }
  pnpm rebuild esbuild 2>/dev/null || true
fi

# ---------- 4. 数据库初始化 ----------
echo -e "${BLUE}🗄️  初始化数据库...${NC}"
cd apps/server
# pnpm 10 默认忽略 postinstall，需显式生成 Prisma Client
npx prisma generate >/dev/null 2>&1 || npx prisma generate
npx prisma migrate deploy >/dev/null 2>&1 || npx prisma migrate deploy
cd "$PROJECT_ROOT"

# ---------- 5. 构建 ----------
echo -e "${BLUE}🔨 构建前后端...${NC}"
pnpm run -r build

# ---------- 6. 启动 ----------
echo ""
echo -e "${GREEN}🚀 V-RSS 启动中...${NC}"
echo -e "   管理界面: ${BLUE}http://localhost:4000/dash${NC}"
echo -e "   授权码已从 apps/server/.env 加载（不会在终端显示）"
echo -e "   停止: Ctrl+C"
echo ""
cd apps/server && exec node dist/main
