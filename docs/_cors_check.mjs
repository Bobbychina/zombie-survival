/* 静态站能不能直连各家的 OAuth/API：用真实浏览器从 https 源发 fetch，看是不是被 CORS 挡掉。
   用假 client_id —— 要的就是"哪怕报错也说明能跨域拿到响应"。 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const origin = process.argv[2] || 'https://bobbychina.github.io/';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
await page.goto(origin, { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async () => {
  const post = async (url, body, headers = {}) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const t = await r.text();
      return { ok: true, status: r.status, acao: r.headers.get('access-control-allow-origin'), body: t.slice(0, 160) };
    } catch (e) { return { ok: false, err: String(e.message).slice(0, 120) }; }
  };
  const get = async (url, headers = {}) => {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
      return { ok: true, status: r.status, acao: r.headers.get('access-control-allow-origin'), body: (await r.text()).slice(0, 120) };
    } catch (e) { return { ok: false, err: String(e.message).slice(0, 120) }; }
  };
  return {
    origin: location.origin,
    gh_device_code: await post('https://github.com/login/device/code', { client_id: 'Ov23liFAKEfakefake00', scope: 'gist' }),
    gh_token: await post('https://github.com/login/oauth/access_token',
      { client_id: 'Ov23liFAKEfakefake00', device_code: 'fake', grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    gh_token_pkce: await post('https://github.com/login/oauth/access_token',
      { client_id: 'Ov23liFAKEfakefake00', code: 'fake', code_verifier: 'x'.repeat(43) }),
    gh_userinfo: await get('https://api.github.com/user', { Authorization: 'Bearer fake' }),
    gh_gists: await get('https://api.github.com/gists', { Authorization: 'Bearer fake' }),
    ms_token: await post('https://login.microsoftonline.com/common/oauth2/v2.0/token',
      { client_id: '00000000-0000-0000-0000-000000000000', grant_type: 'authorization_code', code: 'x', redirect_uri: location.origin + '/games/oauth-callback.html', code_verifier: 'y'.repeat(43), scope: 'openid profile offline_access Files.ReadWrite.AppFolder' },
      { 'Content-Type': 'application/x-www-form-urlencoded' }),
    ms_discovery: await get('https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration'),
    ms_graph_me: await get('https://graph.microsoft.com/v1.0/me', { Authorization: 'Bearer fake' }),
    ms_graph_appfolder: await get("https://graph.microsoft.com/v1.0/me/drive/special/approot", { Authorization: 'Bearer fake' }),
  };
});
writeFileSync('E:/Files/Games/zombieSurvival/docs/_cors_check.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
for (const [k, v] of Object.entries(out)) console.log(k, '=', JSON.stringify(v));
