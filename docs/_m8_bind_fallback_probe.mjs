/* M8 探针 · 一键授权失败后的补救路径（用户真实遇到：换 token 报 Failed to fetch）
   模拟：授权页正常打开并回传 code，但换 token 被挡（route.abort）→
   断言 ① 出现"被挡住"的补救面板（令牌输入框 + 令牌页按钮 + 设备码按钮）
        ② 面板里直接粘贴令牌 → 绑定成功（api.github.com 打桩）
        ③ 截图存档
   用法：node docs/_m8_bind_fallback_probe.mjs [siteRoot] */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'http://127.0.0.1:5180').replace(/\/$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m8_shots';
mkdirSync(dir, { recursive: true });
const out = { site, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
const ev = (fn, arg) => page.evaluate(fn, arg);

/* api.github.com 打桩：只认令牌，用于验证"粘贴令牌就绑定成功" */
const seen = { user: 0, gists: 0 };
await page.route('https://api.github.com/**', route => {
  const url = route.request().url();
  const json = (o, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  if (url.endsWith('/user')) { seen.user++; return json({ login: 'bobbychina32747', name: 'Bobby', avatar_url: '' }); }
  if (url.includes('/gists')) { seen.gists++; return json([]); }
  return json({ message: 'not stubbed' }, 404);
});
/* 关键：把换 token 那条打挂，模拟用户遇到的 CORS 失败 */
await page.route('https://github.com/login/oauth/**', route => route.abort());

await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(500);
await ev(() => { window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return { closed: false, close() { } }; }; });

out.steps.setup = await ev(async () => {
  const r = await window.DSHAccount.register({ name: 'fallbackprobe', password: 'probe-secret-1' });
  window.panel();
  return { registered: r.ok, panelOpen: !!document.getElementById('mo-bd') };
});
await page.waitForTimeout(300);
await page.click('#mo-bd button:has-text("绑定 GitHub")');
await page.waitForTimeout(300);
await page.click('#mo-ft button.ok');                   // 我明白，继续授权
await page.waitForTimeout(400);
/* 手动把授权码塞回去（等价于用户在 GitHub 点了 Authorize、回调页转发了 code） */
await ev(() => {
  const url = (window.__opened || [])[0] || '';
  const st = new URLSearchParams((url.split('?')[1]) || '').get('state') || '';
  window.postMessage({ type: 'dsh-oauth', provider: 'github', code: 'CODE_AFTER_CONSENT', state: st }, location.origin);
});
await page.waitForTimeout(1500);

out.steps.failPanel = await ev(() => {
  const bd = document.getElementById('mo-bd');
  return {
    title: document.getElementById('mo-title').textContent.trim(),
    mentionsCors: /跨域头|CORS/i.test(bd.innerText),
    explainsNoToken: /没有拿到任何令牌/.test(bd.innerText),
    showsRawError: /Failed to fetch/.test(bd.innerText),
    hasTokenInput: !!document.getElementById('i-tok'),
    hasTokenPageButton: /打开 GitHub 令牌页/.test(bd.innerText),
    hasDeviceButton: [...document.querySelectorAll('#mo-ft button')].some(b => /设备码/.test(b.textContent)),
    hasFileAlternative: /导出存档文件/.test(bd.innerText),
  };
});
out.steps.failShot = dir + '/bind-fallback.png';
await page.screenshot({ path: out.steps.failShot, fullPage: true });

/* 补救：直接粘贴令牌 */
await page.fill('#i-tok', 'ghp_' + 'p'.repeat(36));
await page.click('#mo-ft button:has-text("绑定")');
await page.waitForTimeout(900);
out.steps.tokenBind = await ev(() => {
  const u = window.DSHAccount.current();
  return { bound: !!(u && u.providers.github), login: u && u.providers.github && u.providers.github.login,
    title: document.getElementById('mo-title').textContent.trim() };
});
out.steps.apiCalls = seen;

out.steps.cleanup = await ev(() => { const r = window.DSHAccount.deleteAccount('fallbackprobe'); return { ok: r.ok }; });
writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_bind_fallback.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify({ failPanel: out.steps.failPanel, tokenBind: out.steps.tokenBind, apiCalls: seen, errors: out.errors }, null, 1));
