/* M8 探针 · 存档完整性（反作弊取证）
   ① 正常存档 → 指纹校验通过
   ② 在 localStorage 里手改数值（不重算指纹）→ 重载后必须被判为"被修改过"，并写进日志 + 账号面板
   ③ 越界值（hp > hpMax）走 implausible 分支
   ④ 被改过之后写档：标记要一直带着（tampered 不消失）
   ⑤ 云端/文件来的被改档：verdictOf 判 tampered；applySave 时 confirm=false 必须**不覆盖**本机
   用法：node docs/_m8_integrity_probe.mjs [baseUrl] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const base = (process.argv[2] || 'http://127.0.0.1:5180/games/zombie-survival/index.html').replace(/\?.*$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m8_shots';
mkdirSync(dir, { recursive: true });
const out = { base, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 2047, height: 1157 } })).newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

/* ① 正常存档 + 重载 */
await page.goto(base + '?dev=fresh', { waitUntil: 'load' });
await page.waitForTimeout(2500);
out.steps.firstSave = await ev(() => {
  const S = window.DEV.state();
  S.mat = 41; S.day = 6;
  window.saveGame(true);
  const raw = JSON.parse(localStorage.getItem('zombie_survival_save_v2'));
  return { saved: !!raw.__integrity, digest: raw.__integrity && raw.__integrity.d, tamperedFlag: !!(raw.__integrity && raw.__integrity.tampered) };
});
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);
out.steps.afterCleanReload = await ev(() => ({
  verdict: window.V4Integrity.verdict(),
  tampered: window.V4Integrity.tampered(),
  integrityLog: [...document.querySelectorAll('#log div')].map(e => e.innerText).filter(t => /指纹|存档检查/.test(t)),
  mat: window.S.mat,
}));

/* ② 手改数值：不重算指纹 */
out.steps.tamper = await ev(() => {
  const key = 'zombie_survival_save_v2';
  const raw = JSON.parse(localStorage.getItem(key));
  const before = { mat: raw.mat, digest: raw.__integrity.d };
  raw.mat = 5000;                       // 改钱：不动指纹
  localStorage.setItem(key, JSON.stringify(raw));
  return before;
});
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);
out.steps.afterTamper = await ev(() => ({
  verdict: window.V4Integrity.verdict(),
  tampered: window.V4Integrity.tampered(),
  mat: window.S.mat,
  integrityLog: [...document.querySelectorAll('#log div')].map(e => e.innerText).filter(t => /指纹|存档检查|修改/.test(t)),
}));

/* ③ 越界值：hp 超过 hpMax */
out.steps.implausible = await ev(() => {
  const key = 'zombie_survival_save_v2';
  const raw = JSON.parse(localStorage.getItem(key));
  raw.hp = 99999;                       // hpMax 只有 100 → 典型改档手法
  localStorage.setItem(key, JSON.stringify(raw));
  return window.V4Integrity.verdict ? 'written' : 'written';
});
await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(2500);
out.steps.afterImplausible = await ev(() => ({
  verdict: window.V4Integrity.verdict(),
  tampered: window.V4Integrity.tampered(),
  hp: window.S.hp, hpMax: window.S.hpMax,
  log: [...document.querySelectorAll('#log div')].map(e => e.innerText).filter(t => /指纹|存档检查|越界|修改/.test(t)),
}));

/* ④ 被改过之后继续玩：标记必须一直带着 */
out.steps.tamperSticky = await ev(() => {
  window.saveGame(true);
  const raw = JSON.parse(localStorage.getItem('zombie_survival_save_v2'));
  return { flagOnSave: !!(raw.__integrity && raw.__integrity.tampered), api: window.V4Integrity.tampered() };
});

/* ⑤ 云端/文件来的被改档：先判、再拦 */
out.steps.foreign = await ev(() => {
  const good = JSON.parse(localStorage.getItem('zombie_survival_save_v2'));
  const bad = JSON.parse(JSON.stringify(good));
  bad.mat = 888888;
  const goodV = window.V4Integrity.verdictOf(JSON.parse(JSON.stringify(good)));
  const badV = window.V4Integrity.verdictOf(bad);
  /* applySave 遇到被改档会弹 confirm：这里模拟"玩家点取消" → 本机进度必须原样 */
  const matBefore = window.S.mat;
  const origConfirm = window.confirm;
  window.confirm = () => false;
  const applied = window.V4.account.applySave(bad);
  window.confirm = origConfirm;
  return { goodVerdict: goodV.state, badVerdict: badV.state, badTampered: badV.tampered, applied, matBefore, matAfter: window.S.mat };
});

/* ⑥ 面板里那行完整性提示 + 截图 */
await ev(() => { window.closeAllModals(); window.V4Account.open(); });
await page.waitForTimeout(500);
out.steps.panel = await ev(() => ({
  line: [...document.querySelectorAll('.overlay .hint')].map(e => e.textContent).filter(t => /指纹|完整|修改/.test(t)),
  summary: window.V4Integrity.summary(),
}));
out.steps.shot = dir + '/integrity-panel.png';
await page.screenshot({ path: out.steps.shot, fullPage: true });

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_integrity_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify(out.steps, null, 1).slice(0, 2400));
console.log('errors:', JSON.stringify(out.errors));
