/* 本地版云账号后端：把同一份 cf-worker.js 跑在 Node 上（内存 KV），
   让浏览器端联调不必先部署到 Cloudflare。
   用法：node tools/dev-api-server.mjs [--port 5199]
   注意：内存存储 —— 进程一停数据就没了，只用于联调与自动化测试。 */
import { createServer } from 'node:http';
import { handle } from './cf-worker.js';
import { memoryKV } from './memory-kv.mjs';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = Number(portArg >= 0 ? args[portArg + 1] : 5199);
const env = { DSH_KV: memoryKV(), DSH_PEPPER: process.env.DSH_PEPPER || 'dev-pepper-not-for-production' };

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const url = 'http://127.0.0.1:' + port + req.url;
  const request = new Request(url, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string')),
    ...(body && req.method !== 'GET' && req.method !== 'HEAD' ? { body } : {}),
  });
  try {
    const r = await handle(request, env);
    const text = await r.text();
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers).end(text);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'internal', message: String(e && e.message || e) }));
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log('[dev-api] http://127.0.0.1:' + port + '  （内存 KV，重启即清空）');
  console.log('[dev-api] 自检：curl http://127.0.0.1:' + port + '/api/health');
});
