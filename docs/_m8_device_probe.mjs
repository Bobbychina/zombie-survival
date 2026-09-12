/* 设备码轮询能不能免 secret 走通（GitHub 的 device_code grant 不需要 client_secret）
   期望：authorization_pending（= 通道通、只是在等用户在浏览器里确认），而不是 incorrect_client_credentials。
   用法：node docs/_m8_device_probe.mjs [relayUrl] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const relay = (process.argv[2] || 'https://dsh-oauth-relay.bobby-minecraft.workers.dev').replace(/\/$/, '');
const CID = 'Ov23liPzQ7xNDx0FdUdh';

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
await page.goto('https://bobbychina.github.io/games/', { waitUntil: 'load' });
const post = (url, body) => page.evaluate(async ([u, b]) => {
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: b });
    return { status: r.status, body: (await r.text()).slice(0, 240) };
  } catch (e) { return { err: String(e.message).slice(0, 90) }; }
}, [url, body]);
const form = o => new URLSearchParams(o).toString();

const out = { relay, steps: {} };
out.steps.deviceCode = await post(relay + '/login/device/code', form({ client_id: CID, scope: 'gist read:user' }));
let dc = '';
try { dc = JSON.parse(out.steps.deviceCode.body).device_code; } catch (e) { /* ignore */ }
out.steps.pollNoSecret = dc
  ? await post(relay + '/oauth/access_token', form({ client_id: CID, device_code: dc, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }))
  : { skipped: '没拿到 device_code' };
/* 对照：authorization_code 交换（我们预期它要 secret，所以会 incorrect_client_credentials） */
out.steps.codeExchangeNoSecret = await post(relay + '/oauth/access_token', form({
  client_id: CID, code: 'diagnostic', code_verifier: 'v'.repeat(43),
  redirect_uri: 'https://bobbychina.github.io/games/oauth-callback.html',
}));

/* 走客户端库本身（会用 auth-config.js 里配的 relay）：能拿到 user_code 就说明"设备码绑定"整条链路可用 */
out.steps.clientDevice = await page.evaluate(async () => {
  if (!window.DSHAccount) return { err: '页面没有 DSHAccount' };
  if (!(window.DSH_AUTH_CONFIG && window.DSH_AUTH_CONFIG.github.relay)) return { err: 'auth-config 里没有配 relay' };
  const info = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 10000);
    window.DSHAccount.bindGitHubDevice((i) => { clearTimeout(t); resolve(i); });   // 不 await：拿到码即证明通道可用
  });
  return info || { err: '10 秒内没拿到设备码' };
});

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_device.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log('device/code  →', out.steps.deviceCode.body);
console.log('poll(免 secret) →', out.steps.pollNoSecret.body || JSON.stringify(out.steps.pollNoSecret));
console.log('code 交换(免 secret) →', out.steps.codeExchangeNoSecret.body);
