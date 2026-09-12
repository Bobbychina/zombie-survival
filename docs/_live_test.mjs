/* 线上全链路测试：直接用线上页面 + 线上 Worker（我这边 curl 连不上 workers.dev，所以走浏览器）
   覆盖：health / 中继 / 注册 / 云存档（密文）/ 状态 / 登出 / 换设备登录解密 / 注销
   用法：node docs/_live_test.mjs [site] [api] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'https://bobbychina.github.io').replace(/\/$/, '');
const api = (process.argv[3] || 'https://dsh-oauth-relay.bobby-minecraft.workers.dev').replace(/\/$/, '');
const NAME = 'livetest' + Math.floor(Math.random() * 10000);
const PASS = 'live-test-secret-1';
const SAVE = { day: 33, hp: 55, canary: 'LIVE-CANARY-7788', inv: { wood: 3 } };

const out = { site, api, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });

async function device(tag) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', e => out.errors.push(tag + ':' + String(e.message).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/frame-ancestors/.test(m.text())) out.errors.push(tag + ':console:' + m.text().slice(0, 140)); });
  await page.goto(site + '/games/', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return page;
}

const A = await device('A');

/* 1. health + 中继（都不需要登录） */
out.steps.health = await A.evaluate(async (u) => {
  try { const r = await fetch(u + '/api/health'); return await r.json(); }
  catch (e) { return { error: String(e.message) }; }
}, api);
out.steps.relay = await A.evaluate(async (u) => {
  try {
    const r = await fetch(u + '/relay/login/device/code', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'client_id=Ov23liPzQ7xNDx0FdUdh&scope=gist',
    });
    const t = await r.text();
    return { status: r.status, body: t.slice(0, 200) };
  } catch (e) { return { error: String(e.message) }; }
}, api);

/* 2. 注册（走客户端库，即真实用户路径） */
out.steps.register = await A.evaluate(async ([name, pass]) => {
  const a = window.DSHAccount;
  const srv = a.serverInfo();
  const avail = await a.serverAvailable();
  const r = await a.register({ name, password: pass });
  return { apiConfigured: srv.enabled, available: avail, ok: r.ok, err: r.err, server: r.server,
    unlocked: !a.cryptoInfo().locked, backend: a.backend() };
}, [NAME, PASS]);

/* 3. 上传存档 → 直接看服务端存的是不是密文 */
out.steps.save = await A.evaluate(async ([save]) => {
  const a = window.DSHAccount;
  a.savePut('zombie-survival', 'main', save);
  await new Promise(r => setTimeout(r, 1200));
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const raw = await (await fetch(window.DSH_AUTH_CONFIG.api + '/api/save?game=zombie-survival&slot=main', { headers: { Authorization: 'Bearer ' + t } })).json();
  const txt = JSON.stringify(raw);
  return {
    envelope: { e: raw.data && raw.data.e, alg: raw.data && raw.data.alg, iv: !!(raw.data && raw.data.iv), ct: !!(raw.data && raw.data.ct) },
    serverHasCanary: txt.includes('LIVE-CANARY-7788'), bytes: raw.bytes, updatedAt: raw.updatedAt,
  };
}, [SAVE]);

/* 4. /api/me + GitHub 绑定状态 */
out.steps.me = await A.evaluate(async () => {
  const a = window.DSHAccount;
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const me = await (await fetch(window.DSH_AUTH_CONFIG.api + '/api/me', { headers: { Authorization: 'Bearer ' + t } })).json();
  const gh = await a.ghStatus();
  return { uid: me.uid, name: me.name, games: me.games, ghBound: gh.bound, ghLogin: gh.login || '' };
});

/* 5. 登出 → token 立刻作废 */
out.steps.logout = await A.evaluate(async () => {
  const a = window.DSHAccount;
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  await a.logout();
  const r = await fetch(window.DSH_AUTH_CONFIG.api + '/api/me', { headers: { Authorization: 'Bearer ' + t } });
  return { meAfterLogout: r.status };
});

/* 6. 另一台设备：登录 → 拉取 → 解密 */
const B = await device('B');
out.steps.deviceB = await B.evaluate(async ([name, pass]) => {
  const a = window.DSHAccount;
  const bad = await a.login({ name, password: 'WRONG' });
  const r = await a.login({ name, password: pass });
  const pulled = r.ok ? await a.pullAll('zombie-survival') : null;
  return { wrongPassword: bad.err, login: r.ok, server: r.server, unlocked: !a.cryptoInfo().locked,
    pulled: pulled && pulled.pulled, decrypted: a.saveGet('zombie-survival', 'main') };
}, [NAME, PASS]);

/* 7. 注销（服务端一起清） */
out.steps.deleteAccount = await B.evaluate(async ([name]) => {
  const d = await window.DSHAccount.deleteAccount(name);
  const r = await window.DSHAccount.login({ name, password: 'live-test-secret-1' });
  return { deleted: d.ok, note: d.note, loginAfterDelete: r.ok, err: r.err };
}, [NAME]);

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_live_test.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify(out.steps, null, 1));
console.log('errors: ' + JSON.stringify(out.errors));
