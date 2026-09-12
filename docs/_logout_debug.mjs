/* 定点排查：登出到底有没有真的打到服务端 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const site = 'http://127.0.0.1:5180';
const api = 'http://127.0.0.1:5199';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
const seen = [];
page.on('request', r => { if (r.url().includes('/api/')) seen.push(r.method() + ' ' + r.url().replace(api, '') + ' auth=' + (r.headers()['authorization'] ? 'yes' : 'no')); });
page.on('response', async r => { if (r.url().includes('/api/')) seen.push('  ← ' + r.status() + ' ' + r.url().replace(api, '')); });
await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(400);
const out = await page.evaluate(async (apiRoot) => {
  window.DSH_AUTH_CONFIG.api = apiRoot;
  const a = window.DSHAccount;
  const r = await a.register({ name: 'logoutprobe2', password: 'probe-secret-1' });
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const before = await (await fetch(apiRoot + '/api/me', { headers: { Authorization: 'Bearer ' + t } })).status;
  const lo = await a.logout();
  const after = await (await fetch(apiRoot + '/api/me', { headers: { Authorization: 'Bearer ' + t } })).status;
  return { registered: r.ok, server: r.server, tokenLen: (t || '').length, before, logoutResult: lo, after,
    sessionAfter: localStorage.getItem('dsh.session.v1') };
}, api);
await page.waitForTimeout(500);
console.log(JSON.stringify(out, null, 1));
console.log('网络轨迹:\n' + seen.join('\n'));
await browser.close();
