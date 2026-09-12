#!/usr/bin/env bash
# 丧尸末日生存 v4.0 · 余烬（大世界）—— 一键启动（macOS / Linux / Git Bash）
set -e

cd "$(dirname "$0")"

echo ""
echo "  =========================================================="
echo "    丧尸末日生存 v4.0 · 余烬（大世界）   Zombie Survival"
echo "  =========================================================="
echo ""

# ---------- 1. 环境检查 ----------
echo "  [1/4] 环境检查"
if ! command -v node >/dev/null 2>&1; then
  echo "       [失败] 没找到 Node.js —— 去 https://nodejs.org 装一个 v18+"
  echo "       小提示: 也可以直接用浏览器打开 dist/index.html（不需要 Node）"
  exit 1
fi
echo "       [ OK ] Node.js $(node --version)"
if ! command -v npm >/dev/null 2>&1; then
  echo "       [失败] 没找到 npm"
  exit 1
fi
echo "       [ OK ] npm $(npm --version)"
echo ""

# ---------- 2. 依赖 ----------
echo "  [2/4] 依赖检查"
if [ ! -d node_modules ]; then
  echo "       [提示] 首次运行，正在安装依赖（vite / typescript / vitest）..."
  npm install --no-fund --no-audit
fi
echo "       [ OK ] 依赖就绪"
echo ""

# ---------- 3. 构建 ----------
echo "  [3/4] 构建游戏"
npm run build
echo "       [ OK ] dist/index.html $(wc -c < dist/index.html) 字节"
echo ""

# ---------- 4. 起服务并打开浏览器 ----------
echo "  [4/4] 启动"
echo "       也可以直接双击根目录的 丧尸末日生存.html（不需要 Node）"
echo "       按 Ctrl+C 结束游戏服务"
echo ""
exec node tools/serve.mjs --root dist --port 5178
