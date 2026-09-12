/* 线上兜底检查：用户还没把 Worker 换成新版（/api/* 还不存在）时，站点必须仍然可用。
   期望：serverInfo().enabled=true（配了地址）、serverAvailable()=false（404）、注册自动退回本机模式。 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const site = process.argv[2] || 'https://bobbychina.github.io';
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(500);
const out = await page.evaluate(async () => {
  const a = window.DSHAccount;
  const info = a.serverInfo();
  const avail = await a.serverAvailable();
  const reg = await a.register({ name: 'fallbackcheck', password: 'probe-secret-1' });
  const back = a.backend();
  const del = await a.deleteAccount('fallbackcheck');
  return { enabled: info.enabled, base: info.base, available: avail,
    registered: reg.ok, server: reg.server, err: reg.err, backend: back, cleanup: del.ok };
});
console.log(JSON.stringify({ ...out, pageErrors: errs }, null, 1));
await browser.close();
