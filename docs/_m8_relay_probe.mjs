/* 中继能不能用：从真实页面源（https://bobbychina.github.io）POST 一个假 code 给中继，
   看它是否把 GitHub 的真实响应带回来（能拿到 GitHub 的 JSON 错误体 = 中继 + GitHub 都通了）。
   用法：node docs/_m8_relay_probe.mjs [relayUrl] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const relay = (process.argv[2] || 'https://dsh-oauth-relay.bobby-minecraft.workers.dev').replace(/\/$/, '');

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
const out = { relay, steps: [] };
await page.goto('https://bobbychina.github.io/games/', { waitUntil: 'load' });
const post = (url, body) => page.evaluate(async ([u, b]) => {
  const t0 = Date.now();
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: b });
    return { ok: true, status: r.status, body: (await r.text()).slice(0, 220), ms: Date.now() - t0 };
  } catch (e) { return { ok: false, err: String(e.message).slice(0, 90), ms: Date.now() - t0 }; }
}, [url, body]);
const get = (url) => page.evaluate(async (u) => {
  try { const r = await fetch(u); return { ok: true, status: r.status, body: (await r.text()).slice(0, 160) }; }
  catch (e) { return { ok: false, err: String(e.message).slice(0, 90) }; }
}, url);

out.steps.push({ name: 'GET 中继根路径（应 405 JSON）', ...(await get(relay + '/')) });
const form = 'client_id=Ov23liPzQ7xNDx0FdUdh&code=diagnostic&code_verifier=' + 'v'.repeat(43) + '&redirect_uri=' + encodeURIComponent('https://bobbychina.github.io/games/oauth-callback.html');
out.steps.push({ name: 'form 换 token（应拿到 GitHub 的 bad_verification_code）', ...(await post(relay + '/oauth/access_token', form)) });
out.steps.push({ name: 'form 申请设备码（应拿到 GitHub 的 device_code）', ...(await post(relay + '/login/device/code', 'client_id=Ov23liPzQ7xNDx0FdUdh&scope=' + encodeURIComponent('gist read:user'))) });
out.steps.push({ name: '不允许的路径（应 404 JSON）', ...(await post(relay + '/whatever', 'x=1')) });

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_relay.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
for (const s of out.steps) console.log((s.ok ? '✅' : '⛔') + ' ' + s.name + ' → ' + JSON.stringify(s).slice(0, 260));
