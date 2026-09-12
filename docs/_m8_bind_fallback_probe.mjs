/* M8 探针 · "一键授权"到底怎么才能通（用户真实遇到：换 token 报 Failed to fetch）
   三个场景，全部用打桩，不碰真实账号：
     A) 直连 + 换 token 被挡（复现用户的现象）→ 断言错误里带"尝试记录"（form / json 两次都记下来）
     B) 配了中继（Cloudflare Worker 那种）→ 断言一键授权**成功**，且请求确实走了中继
     C) 诊断按钮 → 断言四种请求的结果都能列出来（用户复制给作者就能定位）
   用法：node docs/_m8_bind_fallback_probe.mjs [siteRoot] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'http://127.0.0.1:5180').replace(/\/$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m8_shots';
mkdirSync(dir, { recursive: true });
const out = { site, steps: {}, errors: [] };
const RELAY = 'https://relay.test';
const hits = { relay: 0, directBlocked: 0, apiUser: 0, apiGists: 0 };

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

/* GitHub 直连：按开关决定"被挡"还是"可用"；中继：永远可用 */
const state = { blockDirect: true };
const json = (route, o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
await page.route('https://github.com/login/oauth/**', route => {
  if (state.blockDirect) { hits.directBlocked++; return route.abort(); }
  return json(route, { access_token: 'ghp_DIRECT', expires_in: 28800 });
});
await page.route('https://github.com/login/device/code', route =>
  state.blockDirect ? route.abort() : json(route, { device_code: 'd1', user_code: 'AAAA-1111', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 }));
await page.route(RELAY + '/**', route => { hits.relay++; return json(route, { access_token: 'ghp_VIA_RELAY', refresh_token: 'ghr_RELAY', expires_in: 28800, token_type: 'bearer' }); });
await page.route('https://api.github.com/**', route => {
  const url = route.request().url();
  if (url.endsWith('/user')) { hits.apiUser++; return json(route, { login: 'bobbychina32747', name: 'Bobby', avatar_url: '' }); }
  hits.apiGists++; return json(route, []);
});

await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(400);
await ev(() => { window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return { closed: false, close() { } }; }; });
await ev(async () => { await window.DSHAccount.register({ name: 'relayprobe', password: 'probe-secret-1' }); });

/** 走一遍界面上的完整流程：面板 → 绑定 → 确认 → 授权页（stub）→ 回调 */
async function runFlow(label) {
  await ev(() => window.panel());
  await page.waitForTimeout(250);
  await page.click('#mo-bd button:has-text("绑定 GitHub")');
  await page.waitForTimeout(250);
  await page.click('#mo-ft button.ok');                       // 我明白，继续授权
  await page.waitForTimeout(350);
  await ev(() => {
    const url = (window.__opened || []).slice(-1)[0] || '';
    const st = new URLSearchParams((url.split('?')[1]) || '').get('state') || '';
    window.postMessage({ type: 'dsh-oauth', provider: 'github', code: 'CODE_' + Date.now(), state: st }, location.origin);
  });
  await page.waitForTimeout(1500);
  return ev(() => {
    const bd = document.getElementById('mo-bd');
    const u = window.DSHAccount.current();
    return {
      title: document.getElementById('mo-title').textContent.trim(),
      bound: !!(u && u.providers.github),
      login: u && u.providers.github && u.providers.github.login,
      text: bd ? bd.innerText.replace(/\s+/g, ' ').slice(0, 400) : '',
      hasDiagnoseBtn: [...document.querySelectorAll('#mo-ft button')].some(b => /诊断/.test(b.textContent)),
    };
  });
}

/* A) 直连被挡（复现用户遇到的情况） */
out.steps.directBlocked = await runFlow('direct');
out.steps.directBlockedShot = dir + '/bind-fallback.png';
await page.screenshot({ path: out.steps.directBlockedShot, fullPage: true });

/* C) 诊断按钮（此时直连仍被挡 → 应当报出 form/json/设备码 三种都被挡、api.github.com 正常） */
await page.click('#mo-ft button:has-text("诊断")');
await page.waitForTimeout(2500);
out.steps.diagnose = await ev(() => ({
  text: ((document.getElementById('diag') || document.getElementById('acc-diag') || {}).innerText || '(空)'),
}));

/* B) 配中继 → 一键授权应当成功 */
await ev((relay) => { window.DSH_AUTH_CONFIG.github.relay = relay; window.closeAcct(); }, RELAY);
state.blockDirect = true;                                     // 直连依旧被挡，只有中继能通
out.steps.withRelay = await runFlow('relay');

out.steps.counters = { ...hits };
out.steps.cleanup = await ev(() => { const r = window.DSHAccount.deleteAccount('relayprobe'); return { ok: r.ok }; });
writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_bind_fallback.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify({ directBlocked: out.steps.directBlocked, withRelay: out.steps.withRelay, counters: hits, diagnose: out.steps.diagnose.text.slice(0, 260), errors: out.errors }, null, 1));
