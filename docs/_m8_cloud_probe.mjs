/* M8 探针 · 云账号后端（Cloudflare Worker 的同一份代码跑在本地 5199 上）
   验的是"两台设备"的真实闭环：设备 A 注册并上传存档 → 设备 B（全新浏览器 profile）登录并把存档拉下来。
   另外验：错口令被服务端拒、离线时退回本机模式、登出后 token 失效。
   用法：node docs/_m8_cloud_probe.mjs [siteRoot] [apiRoot]
        node tools/dev-api-server.mjs --port 5199   # 先起本地后端 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'http://127.0.0.1:5180').replace(/\/$/, '');
const apiRoot = (process.argv[3] || 'http://127.0.0.1:5199').replace(/\/$/, '');
const out = { site, apiRoot, steps: {}, errors: [] };
const NAME = 'cloudprobe' + Math.floor(Math.random() * 1000);
const PASS = 'probe-secret-1';
const SAVE = { day: 9, hp: 77, mat: 123, inv: { wood: 4 }, __integrity: { d: 'deadbeefdeadbeef' } };

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });

async function newDevice(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => out.errors.push(tag + ':' + String(e.message).slice(0, 160)));
  await page.goto(site + '/games/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  /* 本地联调：把 api 指到本地后端（线上 auth-config 里指向已部署的 Worker） */
  await page.evaluate(a => { window.DSH_AUTH_CONFIG.api = a; }, apiRoot);
  return page;
}

/* 设备 A：健康检查 → 注册 → 上传存档 → 直接问服务端要回来核对 */
const A = await newDevice('A');
out.steps.health = await A.evaluate(async () => {
  const r = await fetch(window.DSH_AUTH_CONFIG.api + '/api/health');
  return await r.json();
});
out.steps.register = await A.evaluate(async ([name, pass]) => {
  const a = window.DSHAccount;
  const available = await a.serverAvailable();
  const r = await a.register({ name, password: pass, email: 'probe@example.com' });
  const s = a.serverInfo();
  return { available, ok: r.ok, err: r.err, server: r.server, loggedIn: s.loggedIn, name: r.user && r.user.name,
    hasToken: !!JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token };
}, [NAME, PASS]);
out.steps.meOnServer = await A.evaluate(async () => {
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const r = await fetch(window.DSH_AUTH_CONFIG.api + '/api/me', { headers: { Authorization: 'Bearer ' + t } });
  return { status: r.status, body: await r.json() };
});
out.steps.pushSave = await A.evaluate(async (save) => {
  const a = window.DSHAccount;
  a.savePut('zombie-survival', 'main', save);
  const up = await a.pushAll('zombie-survival');
  /* 直接从服务端读回来，确认不是"只写了本地" */
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const r = await fetch(window.DSH_AUTH_CONFIG.api + '/api/save?game=zombie-survival&slot=main', { headers: { Authorization: 'Bearer ' + t } });
  const b = await r.json();
  return { pushed: up.pushed, provider: up.provider, serverData: b.data, serverBytes: b.bytes, digest: b.digest };
}, SAVE);

/* 设备 B：全新浏览器 profile → 只凭用户名口令登录 → 把存档拉下来 */
const B = await newDevice('B');
out.steps.deviceB = await B.evaluate(async ([name, pass, site]) => {
  const a = window.DSHAccount;
  const before = a.slots('zombie-survival').length;          // 设备 B 本地应该是空的
  const bad = await a.login({ name, password: 'WRONG-PASS' });
  const r = await a.login({ name, password: pass });
  const pulled = r.ok ? await a.pullAll('zombie-survival') : null;
  return { localSlotsBefore: before, badLogin: { ok: bad.ok, err: bad.err }, login: { ok: r.ok, server: r.server, err: r.err },
    pulled: pulled && pulled.pulled, localSlotsAfter: a.slots('zombie-survival').map ? a.slots('zombie-survival').map(s => s.slot) : null,
    saveNow: a.saveGet('zombie-survival', 'main') };
}, [NAME, PASS, site]);

/* 设备 A 登出 → token 立即失效 */
out.steps.logout = await A.evaluate(async () => {
  const a = window.DSHAccount;
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  await a.logout();                      // 必须 await：服务端注销请求要发完，token 才算真的作废
  const r = await fetch(window.DSH_AUTH_CONFIG.api + '/api/me', { headers: { Authorization: 'Bearer ' + t } });
  return { meAfterLogout: r.status, stillLoggedIn: a.serverInfo().loggedIn };
});

/* 后端不可达时：注册要能退回本机模式（不能因为后端挂了就完全不能用） */
const C = await browser.newContext();
const pc = await C.newPage();
pc.on('pageerror', e => out.errors.push('C:' + String(e.message).slice(0, 160)));
await pc.goto(site + '/games/', { waitUntil: 'load' });
await pc.waitForTimeout(400);
out.steps.offlineFallback = await pc.evaluate(async () => {
  window.DSH_AUTH_CONFIG.api = 'http://127.0.0.1:59999';       // 死端口
  const a = window.DSHAccount;
  const available = await a.serverAvailable();
  const r = await a.register({ name: 'offlineprobe', password: 'probe-secret-1' });
  return { available, registered: r.ok, server: r.server, loggedIn: a.serverInfo().loggedIn, backend: a.backend() };
});

/* 收尾：删掉探针账号（同时验证 deleteAccount 会清服务端） */
out.steps.cleanup = await pc.evaluate(() => window.DSHAccount.deleteAccount('offlineprobe'));
await B.evaluate(async () => { await window.DSHAccount.deleteAccount(JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').uid ? '' : ''); }).catch(() => { });
const cleanup = await (async () => {
  const t = await B.evaluate(async ([name, pass, api]) => {
    window.DSH_AUTH_CONFIG.api = api;
    const a = window.DSHAccount;
    const r = await a.login({ name, password: pass });
    if (!r.ok) return null;
    const d = await a.deleteAccount(name);
    return d;
  }, [NAME, PASS, apiRoot]);
  return t;
})();
out.steps.serverCleanup = cleanup;

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_cloud_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify({
  health: out.steps.health, register: out.steps.register, me: out.steps.meOnServer.status,
  push: { pushed: out.steps.pushSave.pushed, provider: out.steps.pushSave.provider, serverBytes: out.steps.pushSave.serverBytes, digest: out.steps.pushSave.digest },
  deviceB: { before: out.steps.deviceB.localSlotsBefore, bad: out.steps.deviceB.badLogin, login: out.steps.deviceB.login, pulled: out.steps.deviceB.pulled, after: out.steps.deviceB.localSlotsAfter },
  logout: out.steps.logout, offline: out.steps.offlineFallback, cleanup: out.steps.serverCleanup,
  errors: out.errors,
}, null, 1));
