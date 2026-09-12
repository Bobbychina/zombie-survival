/* M8 探针 · GitHub 一键授权的"请求形状"验证（真 client_id，但不去真的连 github.com）
   验什么：① 配置有没有真的加载（大厅页 + 游戏页）② 点「绑定 GitHub」生成的 authorize URL
           是否逐字符合 GitHub 要求（client_id / redirect_uri / scope / state 前缀 / PKCE 挑战）
           ③ 回调页 postMessage 中继能不能把 code 送回主窗口
           ④ github.com 不通时是否优雅降级（给出"改用设备码/令牌"的指引，而不是卡死）
   用法：node docs/_m8_oauth_probe.mjs [siteRoot] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'http://127.0.0.1:5180').replace(/\/$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m8_shots';
mkdirSync(dir, { recursive: true });
const out = { site, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

/* ① 两个页面都要能读到配置 */
await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(400);
out.steps.hubConfig = await ev(() => ({
  github: window.DSH_AUTH_CONFIG.github.clientId,
  redirect: window.DSH_AUTH_CONFIG.redirect,
  microsoft: window.DSH_AUTH_CONFIG.microsoft.clientId || '(未填)',
  openButtonActsAsOAuth: !!window.DSH_AUTH_CONFIG.github.clientId,
}));
await page.goto(site + '/games/zombie-survival/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
out.steps.gameConfig = await ev(() => ({
  configLoaded: !!window.DSH_AUTH_CONFIG,
  github: window.DSH_AUTH_CONFIG && window.DSH_AUTH_CONFIG.github.clientId,
  libVersion: window.DSHAccount && window.DSHAccount.version,
  accountSectionRendered: [...document.querySelectorAll('.wenv .hint')].some(e => /账号|登录/.test(e.textContent)),
}));

/* ② 抓 authorize URL（把 window.open 换成记录器，不真开弹窗） */
await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(400);
await ev(() => {
  window.__opened = [];
  window.open = function (url) { window.__opened.push(String(url)); return { closed: false, close() { } }; };
});
out.steps.authorize = await ev(async () => {
  const A = window.DSHAccount;
  await A.register({ name: 'oauthprobe', password: 'probe-secret-1' });
  const p = A.bindGitHubOAuth();                       // 不 await：先让它把弹窗开出来
  await new Promise(r => setTimeout(r, 300));
  const url = (window.__opened || [])[0] || '';
  const q = new URLSearchParams((url.split('?')[1]) || '');
  const state = q.get('state') || '';
  const shape = {
    host: url.split('?')[0],
    client_id: q.get('client_id'),
    redirect_uri: q.get('redirect_uri'),
    scope: q.get('scope'),
    state_prefix: state.split(':')[0],
    has_state_random: state.length > 20,
    challenge_method: q.get('code_challenge_method'),
    challenge_len: (q.get('code_challenge') || '').length,
    // 把回调页会做的事模拟一遍：postMessage 回主窗口（state 必须原样带回）
    relay: (() => { window.postMessage({ type: 'dsh-oauth', provider: 'github', code: 'FAKE_CODE', state: state }, location.origin); return 'sent'; })(),
  };
  const res = await p;                                  // github.com 不通 → 应当优雅失败
  return { shape, result: { ok: res.ok, err: res.err }, opened: (window.__opened || []).length };
});

/* ③ github.com 完全连不上时（route.abort）也要给出可操作提示，而不是卡死 */
out.steps.fallback = await ev(async () => {
  const A = window.DSHAccount;
  const t0 = Date.now();
  const dev = await A.bindGitHubDevice(() => { });       // 设备码：同样连不上 → 应快速返回错误
  return { ms: Date.now() - t0, ok: dev.ok, err: dev.err,
    mentionsFallback: /令牌|设备码|网络|CORS/i.test(String(dev.err)) };
});
out.steps.cleanup = await ev(() => { const r = window.DSHAccount.deleteAccount('oauthprobe'); return { ok: r.ok, left: Object.keys(localStorage).filter(k => /dsh\./.test(k)) }; });

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_oauth_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify(out.steps.authorize && out.steps.authorize.shape, null, 1));
console.log('errors:', JSON.stringify(out.errors));
