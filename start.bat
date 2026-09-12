@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
title 丧尸末日生存 v4.0 · 余烬（大世界）- 一键启动
cd /d "%~dp0"
color 0B

echo.
echo   ==========================================================
echo     丧尸末日生存 v4.0 · 余烬（大世界）   Zombie Survival
echo   ==========================================================
echo.

:: ---------- 1. 环境检查 ----------
echo   [1/4] 环境检查
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo        [失败] 没找到 Node.js —— 去 https://nodejs.org 装一个 v18+
    echo        小提示: 也可以直接用浏览器打开 dist\index.html（不需要 Node）
    pause
    exit /b 1
)
for /f "tokens=1" %%v in ('node --version') do echo        [ OK ] Node.js %%v
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo        [失败] 没找到 npm
    pause
    exit /b 1
)
for /f "tokens=1" %%v in ('npm --version') do echo        [ OK ] npm %%v
echo.

:: ---------- 2. 依赖 ----------
echo   [2/4] 依赖检查
if not exist "node_modules" (
    echo        [提示] 首次运行，正在安装依赖（vite / typescript / vitest）...
    call npm install --no-fund --no-audit
    if !errorlevel! neq 0 (
        echo        [失败] 依赖安装失败。可以手动执行: npm install
        pause
        exit /b 1
    )
)
echo        [ OK ] 依赖就绪
echo.

:: ---------- 3. 构建（产物是单文件，双击也能玩） ----------
echo   [3/4] 构建游戏
call npm run build
if !errorlevel! neq 0 (
    echo        [失败] 构建失败，看看上面的报错
    pause
    exit /b 1
)
for %%f in ("dist\index.html") do echo        [ OK ] dist\index.html  %%~zf 字节
echo.

:: ---------- 4. 起本地服务器并打开浏览器 ----------
echo   [4/4] 启动
echo        也可以直接双击根目录的 丧尸末日生存.html（不需要 Node）
echo        （这样 localStorage 存档、音频表现和真实网页完全一致）
echo.
echo        关闭这个窗口 = 结束游戏服务
echo.
node "tools\serve.mjs" --root dist --port 5178
echo.
echo   服务已结束。
pause
