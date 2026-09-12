/* 第二轮：改用「简单请求」（form-urlencoded，不触发预检）再试一次——
   第一轮用 JSON 会先发 OPTIONS 预检，被挡可能是预检的锅，不是端点本身不支持跨域。
   同时补测 Microsoft authorize 端点与 Graph 上传（PUT）通道。 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const origin = process.argv[2] || 'https://bobbychina.github.io/';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
const seen = [];
page.on('requestfailed', r => { if (/login\.|github\.com/.test(r.url())) seen.push('FAILED ' + r.url().slice(0, 60) + ' ' + (r.failure() || {}).errorText); });
await page.goto(origin, { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async () => {
  const form = async (url, obj) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(obj).toString(),
      });
      const t = await r.text();
      return { ok: true, status: r.status, acao: r.headers.get('access-control-allow-origin'), body: t.slice(0, 200) };
    } catch (e) { return { ok: false, err: String(e.message).slice(0, 100) }; }
  };
  const put = async (url, headers = {}) => {
    try {
      const r = await fetch(url, { method: 'PUT', headers: { ...headers }, body: 'x' });
      return { ok: true, status: r.status, acao: r.headers.get('access-control-allow-origin'), body: (await r.text()).slice(0, 120) };
    } catch (e) { return { ok: false, err: String(e.message).slice(0, 100) }; }
  };
  return {
    origin: location.origin,
    gh_device_form: await form('https://github.com/login/device/code', { client_id: 'Ov23liFAKEfakefake00', scope: 'gist' }),
    gh_token_form: await form('https://github.com/login/oauth/access_token', { client_id: 'Ov23liFAKEfakefake00', code: 'fake', code_verifier: 'v'.repeat(43) }),
    ms_token_form: await form('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      client_id: '00000000-0000-0000-0000-000000000000', grant_type: 'authorization_code', code: 'x',
      redirect_uri: location.origin + '/games/oauth-callback.html', code_verifier: 'y'.repeat(43), scope: 'openid profile offline_access Files.ReadWrite.AppFolder',
    }),
    ms_devicecode_form: await form('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode', { client_id: '00000000-0000-0000-0000-000000000000', scope: 'openid profile' }),
    graph_put: await put('https://graph.microsoft.com/v1.0/me/drive/special/approot:/save.json:/content', { Authorization: 'Bearer fake', 'Content-Type': 'application/json' }),
    gh_gist_create: await form('https://api.github.com/gists', { description: 'x' }),
  };
});
writeFileSync('E:/Files/Games/zombieSurvival/docs/_cors_check2.json', JSON.stringify({ out, seen }, null, 1), 'utf8');
await browser.close();
for (const [k, v] of Object.entries(out)) console.log(k, '=', JSON.stringify(v));
console.log('failed requests:', JSON.stringify(seen));
