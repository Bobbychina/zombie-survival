/* 零依赖静态服务器：给 start.bat / start.sh 用（不引入任何运行时依赖）。
   - 默认端口 5178，被占用就往后找一个空闲的
   - 根目录 = 项目里的 dist（构建产物是单文件，直接双击也能玩，这里只是让 localStorage/音频表现和真实网页一致）
   - 支持 --root <dir> 与 --port <n>；启动后把 URL 打到 stdout 并在 Windows/macOS 上尝试自动开浏览器 */
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const root = resolve(arg('root', 'dist'));
const wantPort = Number(arg('port', '5178'));
const openBrowser = !args.includes('--no-open') && process.env.NO_OPEN !== '1';   // NO_OPEN=1 供自动化测试用

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

try { await stat(root); } catch {
  console.error('[serve] 找不到目录：' + root + '\n        先跑一次构建：npm install && npm run build');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, normalize(path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      // 单页应用兜底：找不到就回 index.html
      const fallback = join(root, 'index.html');
      const fb = await stat(fallback).catch(() => null);
      if (!fb) { res.writeHead(404).end('404'); return; }
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500).end('500 ' + (e && e.message ? e.message : e));
  }
});

function listen(port, tries = 20) {
  return new Promise((resolveP, reject) => {
    server.once('error', err => {
      if (err.code === 'EADDRINUSE' && tries > 0) resolveP(listen(port + 1, tries - 1));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', () => resolveP(port));
  });
}

const port = await listen(wantPort);
const url = `http://127.0.0.1:${port}/index.html`;
console.log('[serve] 根目录 ' + root);
console.log('[serve] 打开 ' + url);
console.log('[serve] 按 Ctrl+C 结束');

if (openBrowser) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* 打不开就算了，手动点链接 */ }
}
