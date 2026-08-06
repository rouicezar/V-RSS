#!/bin/bash
# WeRSS 开发启动脚本（本地 SQLite 模式）
# 用法: ./dev.sh          # 启动（如果已构建）
#       ./dev.sh rebuild  # 重新构建前后端并启动
set -e
cd "$(dirname "$0")"

echo "🚀 WeRSS 开发启动脚本"
echo "======================"

# 1. 校验依赖
if ! command -v pnpm &>/dev/null; then
  echo "❌ 未找到 pnpm，请先安装: npm i -g pnpm"
  exit 1
fi

# 2. 构建（可选）
if [ "$1" = "rebuild" ] || [ ! -d "apps/server/dist" ]; then
  echo "📦 构建前后端..."
  pnpm run -r build
  cp -r apps/server/client apps/server/dist/client
  echo "✅ 构建完成"
fi

# 3. 启动
echo "🚀 启动服务: http://localhost:4000 (管理界面 /dash)"
cd apps/server
exec node dist/main
