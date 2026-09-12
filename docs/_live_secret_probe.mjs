/* 探一下线上 Worker 到底配了哪些 Secret：
   - 换 token 用假 code：带 client_secret 会回 bad_verification_code；没带会回 incorrect_client_credentials
   - 顺带看 /api/health 报的 kv / pepper 状态 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const api = (process.argv[2] || 'https://dsh-oauth-relay.bobby-minecraft.workers.dev').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
await page.goto('https://bobbychina.github.io/games/', { waitUntil: 'load' });
const out = await page.evaluate(async (u) => {
  const form = (o) => new URLSearchParams(o).toString();
  const post = async (path, body) => {
    try {
      const r = await fetch(u + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
      return { status: r.status, body: (await r.text()).slice(0, 240) };
    } catch (e) { return { err: String(e.message) }; }
  };
  const health = await (await fetch(u + '/api/health')).json();
  const exchange = await post('/relay/oauth/access_token', form({
    client_id: 'Ov23liPzQ7xNDx0FdUdh', code: 'diagnostic',
    redirect_uri: 'https://bobbychina.github.io/games/oauth-callback.html',
  }));
  return { health, exchange };
}, api);
console.log(JSON.stringify(out, null, 1));
console.log('判定：exchange 里出现 bad_verification_code = GH_CLIENT_SECRET 已配；incorrect_client_credentials = 没配');
await browser.close();
