/* M8 探针 · 端到端加密 + 解锁（云后端在本地 5199 上跑同一份 Worker 代码）
   验的是：上传到服务端的是密文（拿不到明文）、换设备登录后能解出来、
   清掉密钥后处于锁定态、输错口令解不开、输对才解锁。
   用法：node docs/_m8_crypto_probe.mjs [siteRoot] [apiRoot] */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'http://127.0.0.1:5180').replace(/\/$/, '');
const api = (process.argv[3] || 'http://127.0.0.1:5199').replace(/\/$/, '');
const NAME = 'cryptoprobe' + Math.floor(Math.random() * 1000);
const PASS = 'probe-secret-1';
/* 放几个"明文标记"，用来证明服务端上确实找不到它们 */
const SAVE = { day: 42, hp: 66, secretMarker: 'PLAINTEXT-CANARY-9931', inv: { wood: 7 } };

const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const out = { site, api, steps: {}, errors: [] };

async function device(tag) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => out.errors.push(tag + ':' + String(e.message).slice(0, 160)));
  await page.goto(site + '/games/', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(a => { window.DSH_AUTH_CONFIG.api = a; }, api);
  return page;
}

/* A：注册 → 上传（加密）→ 直接看服务端存了什么 */
const A = await device('A');
out.steps.aSetup = await A.evaluate(async ([name, pass, save]) => {
  const a = window.DSHAccount;
  const reg = await a.register({ name, password: pass });
  const put = a.savePut('zombie-survival', 'main', save);
  await new Promise(r => setTimeout(r, 900));               // 等异步推送完成
  const t = JSON.parse(localStorage.getItem('dsh.session.v1') || '{}').token;
  const raw = await (await fetch(window.DSH_AUTH_CONFIG.api + '/api/save?game=zombie-survival&slot=main', { headers: { Authorization: 'Bearer ' + t } })).json();
  const rawText = JSON.stringify(raw);
  return {
    registered: reg.ok, server: reg.server, putOk: put.ok,
    cryptoUnlocked: !a.cryptoInfo().locked,
    envelope: { e: raw.data && raw.data.e, alg: raw.data && raw.data.alg, hasIv: !!(raw.data && raw.data.iv), hasCt: !!(raw.data && raw.data.ct) },
    serverHasPlaintextCanary: rawText.includes('PLAINTEXT-CANARY-9931'),
    serverHasDayField: /"day":/.test(rawText),
    envelopeSize: (raw.data && raw.data.ct || '').length,
  };
}, [NAME, PASS, SAVE]);

/* A：抹掉密钥 → 锁定态 → 错口令解不开 → 对口令解锁 */
out.steps.lockUnlock = await A.evaluate(async ([pass]) => {
  const a = window.DSHAccount;
  sessionStorage.removeItem('dsh.eckey.v1');                 // 模拟"关掉标签页后重开"
  const locked = a.cryptoInfo().locked;
  const bad = await a.unlock('WRONG-PASS-123');
  const afterBad = a.cryptoInfo().locked;
  const good = await a.unlock(pass);
  const pulled = good.ok ? await a.pullAll('zombie-survival') : null;
  return { locked, badUnlock: { ok: bad.ok, err: bad.err }, stillLockedAfterBad: afterBad,
    goodUnlock: good.ok, pulled: pulled && pulled.pulled, decrypted: a.saveGet('zombie-survival', 'main') };
}, [PASS]);

/* B：新设备登录 → 自动派生密钥 → 拉下来并解密 */
const B = await device('B');
out.steps.deviceB = await B.evaluate(async ([name, pass]) => {
  const a = window.DSHAccount;
  const r = await a.login({ name, password: pass });
  const pulled = r.ok ? await a.pullAll('zombie-survival') : null;
  return { login: r.ok, server: r.server, unlocked: !a.cryptoInfo().locked, pulled: pulled && pulled.pulled,
    decrypted: a.saveGet('zombie-survival', 'main') };
}, [NAME, PASS]);

/* 收尾：删账号（服务端也清） */
out.steps.cleanup = await B.evaluate(async ([name]) => {
  const d = await window.DSHAccount.deleteAccount(name);
  return d;
}, [NAME]);

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_crypto_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify({ aSetup: out.steps.aSetup, lockUnlock: { locked: out.steps.lockUnlock.locked, bad: out.steps.lockUnlock.badUnlock, stillLocked: out.steps.lockUnlock.stillLockedAfterBad, goodUnlock: out.steps.lockUnlock.goodUnlock, decryptedMarker: out.steps.lockUnlock.decrypted && out.steps.lockUnlock.decrypted.secretMarker }, deviceB: out.steps.deviceB, cleanup: out.steps.cleanup, errors: out.errors }, null, 1));
