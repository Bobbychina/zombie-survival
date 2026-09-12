/* M8 探针：账号系统 + 云存档（游戏厅 /games/ 与游戏 /games/zombie-survival/ 同源共用）
   网络部分用 page.route 打桩（GitHub API / Graph 全程 mock），所以不碰真实账号、不产生真数据；
   验证的是"我们这侧的客户端逻辑 + 界面 + 存档格式"，而不是 GitHub 的服务器。
   用法：node docs/_m8_account_probe.mjs [siteRoot]   （默认 http://127.0.0.1:5179） */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const site = (process.argv[2] || 'http://127.0.0.1:5179').replace(/\/$/, '');
const dir = 'E:/Files/Games/ZombieSurvival/docs/_m8_shots';
mkdirSync(dir, { recursive: true });
const out = { site, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

/* ── 假的 GitHub 云盘（有状态：够验证 creation → push → list → delete 全链路） ── */
const cloud = { gistId: 'gistTEST123', files: {}, created: 0, patches: 0, lastAuth: '', refreshes: 0 };
/* GitHub 的 OAuth 端点在真机上连不通（本机对 github.com 的 HTTPS 是超时），所以连刷新令牌那条路也一起打桩 */
async function stubGitHubOAuth(page) {
  await page.route('https://github.com/login/oauth/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (body.grant_type === 'refresh_token') {
      cloud.refreshes++;
      return json({ access_token: 'ghp_REFRESHED', refresh_token: 'ghr_NEW', expires_in: 28800, token_type: 'bearer' });
    }
    return json({ access_token: 'ghp_FRESH', refresh_token: 'ghr_1', expires_in: 28800, token_type: 'bearer' });
  });
  await page.route('https://github.com/login/device/code', async route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ device_code: 'dev1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 }) }));
}
async function stubGitHub(page) {
  await page.route('https://api.github.com/**', async route => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.endsWith('/user')) { cloud.lastAuth = req.headers()['authorization'] || ''; return json({ login: 'tester', name: 'Tester', avatar_url: 'https://example.com/a.png' }); }
    if (url.includes('/gists?per_page=')) return json(cloud.created ? [{ id: cloud.gistId, description: 'bobbychina.github.io/games 云存档（自动生成，可随时删除）' }] : []);
    if (method === 'POST' && /\/gists$/.test(url)) {
      cloud.created++;
      const body = JSON.parse(req.postData() || '{}');
      cloud.files = Object.assign({}, body.files || {});
      return json({ id: cloud.gistId, files: cloud.files }, 201);
    }
    if (method === 'GET' && url.includes('/gists/' + cloud.gistId)) return json({ id: cloud.gistId, files: cloud.files });
    if (method === 'PATCH' && url.includes('/gists/' + cloud.gistId)) {
      cloud.patches++;
      const body = JSON.parse(req.postData() || '{}');
      Object.keys(body.files || {}).forEach(k => {
        if (body.files[k] === null) delete cloud.files[k];
        else cloud.files[k] = { content: body.files[k].content, truncated: false };
      });
      return json({ id: cloud.gistId, files: cloud.files });
    }
    return json({ message: 'unhandled ' + method + ' ' + url }, 404);
  });
}
async function stubGraph(page) {
  await page.route('https://graph.microsoft.com/**', async route => {
    const req = route.request(), url = req.url(), method = req.method();
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (url.endsWith('/me')) return json({ id: 'ms-oid-1', displayName: '测试用户', mail: 'tester@example.com' });
    if (url.endsWith(':/children')) {
      const names = Object.keys(cloud.files).filter(f => f.startsWith('onedrive__'));
      return json({ value: names.map(n => ({ name: n.replace('onedrive__', ''), lastModifiedDateTime: '2026-09-12T10:00:00Z' })) });
    }
    if (method === 'PUT') { const m = url.match(/approot:\/dsh-saves\/([^/:]+)\/([^/:]+)\.json:\/content/); if (m) { cloud.files['onedrive__' + decodeURIComponent(m[2]) + '.json'] = { content: req.postData() }; return json({ id: 'x' }, 201); } }
    if (method === 'DELETE') { const m = url.match(/approot:\/dsh-saves\/([^/:]+)\/([^/:]+)\.json$/); if (m) { delete cloud.files['onedrive__' + decodeURIComponent(m[2]) + '.json']; return route.fulfill({ status: 204 }); } }
    return json({ error: { message: 'unhandled ' + method + ' ' + url } }, 404);
  });
}
async function stubMSAuth(page) {
  await page.route('https://login.microsoftonline.com/**', async route => {
    const b = new URLSearchParams(route.request().postData() || '');
    if (b.get('grant_type') === 'authorization_code') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'ms-access-1', refresh_token: 'ms-refresh-1', expires_in: 3600, token_type: 'Bearer' }) });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant' }) });
  });
}

const page = await ctx.newPage();
page.on('pageerror', e => out.errors.push(String(e.message).slice(0, 200)));
await stubGitHub(page); await stubGraph(page); await stubMSAuth(page); await stubGitHubOAuth(page);
const ev = (fn, arg) => page.evaluate(fn, arg);

/* ① 游戏大厅：页面结构 + 账号库装载 */
await page.goto(site + '/games/', { waitUntil: 'load' });
await page.waitForTimeout(600);
out.steps.hub = await ev(() => ({
  title: document.title,
  hasLib: typeof window.DSHAccount === 'object',
  libVersion: window.DSHAccount && window.DSHAccount.version,
  games: [...document.querySelectorAll('.game h3')].map(e => e.textContent.trim()),
  playBtns: [...document.querySelectorAll('.game .btn')].map(e => e.textContent.trim()),
  acctBar: document.getElementById('acct-who').textContent.trim(),
  configLoaded: !!window.DSH_AUTH_CONFIG,
  githubClientIdSet: !!(window.DSH_AUTH_CONFIG && window.DSH_AUTH_CONFIG.github.clientId),
}));

/* ② 注册 → 会话持久化（刷新还在） → 密码校验（错密码要拒绝） */
out.steps.register = await ev(async () => {
  const r = await window.DSHAccount.register({ name: 'tester', password: 'hunter2secret', email: '' });
  return { ok: r.ok, err: r.err, name: r.user && r.user.name, keys: Object.keys(localStorage).sort() };
});
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(500);
out.steps.sessionPersist = await ev(() => ({
  loggedIn: !!window.DSHAccount.current(),
  who: document.getElementById('acct-who').textContent.trim(),
  wrongPass: null,
}));
out.steps.wrongPassword = await ev(async () => {
  window.DSHAccount.logout();
  const bad = await window.DSHAccount.login({ name: 'tester', password: 'WRONG' });
  const good = await window.DSHAccount.login({ name: 'tester', password: 'hunter2secret' });
  return { badOk: bad.ok, badErr: bad.err, goodOk: good.ok };
});

/* ③ 界面：点「账号与云存档」应该出现绑定按钮 */
await page.click('#btn-acct');
await page.waitForTimeout(300);
out.steps.panel = await ev(() => ({
  title: document.getElementById('mo-title').textContent.trim(),
  buttons: [...document.querySelectorAll('#mo-ft button')].map(b => b.textContent.trim()),
  bindButtons: [...document.querySelectorAll('#mo-bd button')].map(b => b.textContent.trim()),
  saves: (document.getElementById('saves') || {}).textContent,
}));

/* ③b 隐私披露：站内说明页 + 授权前的确认闸门（不确认不许跳 GitHub） */
out.steps.privacy = await ev(() => {
  window.privacy();
  const bd = document.getElementById('mo-bd');
  const r = {
    title: document.getElementById('mo-title').textContent.trim(),
    mentionsNoData: /不收集任何数据/.test(bd.innerText),
    mentionsGistScope: /Gists/.test(bd.innerText),
    mentionsProfileScope: /Personal user data/.test(bd.innerText),
    mentionsTokenStorage: /localStorage/.test(bd.innerText),
    mentionsRevoke: /settings\/applications/.test(bd.innerHTML),
    mentionsFileAlt: /导出存档文件/.test(bd.innerText),
    linksPrivacyMd: /PRIVACY\.md/.test(bd.innerHTML),
  };
  window.closeAcct();
  return r;
});
out.steps.consentGate = await ev(async () => {
  window.__opened = [];
  window.open = function (url) { window.__opened.push(String(url)); return { closed: false, close() { } }; };
  window.panel();
  await new Promise(r => setTimeout(r, 250));
  const bindBtn = [...document.querySelectorAll('#mo-bd button')].find(b => /绑定 GitHub/.test(b.textContent));
  if (!bindBtn) return { err: '找不到绑定按钮' };
  bindBtn.click();
  await new Promise(r => setTimeout(r, 250));
  const bd = document.getElementById('mo-bd');
  const before = {
    title: document.getElementById('mo-title').textContent.trim(),
    gistScope: /Gists — 读写/.test(bd.innerText),
    profileScope: /Personal user data/.test(bd.innerText),
    storageNote: /localStorage/.test(bd.innerText),
    revokeLink: /settings\/applications/.test(bd.innerHTML),
    fileAlternative: /导出存档文件/.test(bd.innerText),
    openedBeforeConfirm: window.__opened.length,
  };
  const okBtn = document.querySelector('#mo-ft button.ok');
  okBtn.click();
  await new Promise(r => setTimeout(r, 300));
  const openedAfterConfirm = window.__opened.length;
  const url = window.__opened[0] || '';
  const st = new URLSearchParams((url.split('?')[1]) || '').get('state') || '';
  window.postMessage({ type: 'dsh-oauth', provider: 'github', code: 'GATE_TEST', state: st }, location.origin);
  await new Promise(r => setTimeout(r, 900));
  window.closeAcct();
  return { before, openedAfterConfirm, authorizedHost: url.split('?')[0] };
});

/* ④ 绑定 GitHub（令牌路：api.github.com 已被打桩） */
out.steps.bindGithub = await ev(async () => {
  const r = await window.DSHAccount.bindGitHubToken('ghp_' + 'x'.repeat(36));
  const u = window.DSHAccount.current();
  return { ok: r.ok, err: r.err, providers: u.providers, who: document.getElementById('acct-who').textContent.trim() };
});

/* ④b GitHub 过期令牌自动刷新（OAuth App 勾了「Expire user access tokens」时才有刷新令牌） */
out.steps.githubRefresh = await ev(async () => {
  const A = window.DSHAccount;
  A._bind('github', { token: 'ghp_EXPIRED', login: 'tester', name: 'Tester', refresh: 'ghr_OLD', exp: Date.now() - 1000, boundAt: new Date().toISOString() });
  const tok = await A._cloudToken('github');
  const raw = A._raw().providers.github;
  const sum = await A.cloudSummary('zombie-survival');
  return { refreshedToken: tok, storedToken: raw.token, keptRefresh: raw.refresh, cloudReadOk: sum.ok };
});
out.steps.githubRefreshServer = { refreshes: cloud.refreshes, lastAuthSeen: cloud.lastAuth };

/* ⑤ 存档：写入 → 推云 → 列云 → 删云（云端=打桩的私有 gist） */
out.steps.saveFlow = await ev(async () => {
  const A = window.DSHAccount;
  const fake = { day: 12, hp: 88, mat: 41, world: { seed: 'probe', cur: { x: 3, y: 4 } }, inv: { wood: 9 } };
  const put = A.savePut('zombie-survival', 'main', fake);
  const push = await A.pushAll('zombie-survival');
  const sum = await A.cloudSummary('zombie-survival');
  const back = A.saveGet('zombie-survival', 'main');
  const del = await A.cloudDelete('zombie-survival', 'main');
  const sum2 = await A.cloudSummary('zombie-survival');
  return { putOk: put.ok, pushed: push.pushed, remote1: sum.remote, remote2: sum2.remote, delOk: del.ok,
    roundTripSame: JSON.stringify(back) === JSON.stringify(fake), bytes: put.bytes };
});
out.steps.cloudFiles = JSON.parse(JSON.stringify(cloud));

/* ⑥ 微软绑定（token/graph 都打桩）+ OneDrive 上传 + 导出/导入 */
out.steps.bindMS = await ev(async () => {
  const A = window.DSHAccount;
  A.unbind('github');                                     // 换绑微软，验证 OneDrive 那条路
  const c = A.config();
  const oldId = c.microsoft.clientId;
  window.DSH_AUTH_CONFIG.microsoft.clientId = '11111111-2222-3333-4444-555555555555';
  /* 打桩环境下不开真弹窗：直接调内部令牌交换 + _bind，等价于回调拿到 code 之后的那一步 */
  const tok = await A._msToken({ grant_type: 'authorization_code', code: 'fake-code', code_verifier: 'v'.repeat(43) });
  let bound = { ok: false, err: 'no _msToken' };
  if (tok && tok.access_token) {
    const me = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + tok.access_token } }).then(r => r.json());
    bound = A._bind('microsoft', { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + 3600000, oid: me.id, name: me.displayName, email: me.mail, boundAt: new Date().toISOString() });
  }
  window.DSH_AUTH_CONFIG.microsoft.clientId = oldId;
  const push = await A.pushAll('zombie-survival');
  const sum = await A.cloudSummary('zombie-survival');
  const exp = A.exportAll();
  const imp = A.importAll(exp.json);
  return { bound, push, remote: sum.remote, exportOk: exp.ok, exportBytes: (exp.json || '').length, importOk: imp.ok, importCount: imp.count };
});
out.steps.cloudFilesAfterMS = JSON.parse(JSON.stringify(cloud));

/* ⑦ 游戏本体（同源）：账号模块在场、面板能开、存档能互通 */
await page.goto(site + '/games/zombie-survival/', { waitUntil: 'load' });
await page.waitForTimeout(3000);
out.steps.game = await ev(async () => {
  const S = window.S || {};
  const acctHint = [...document.querySelectorAll('.wenv .hint')].map(e => e.textContent).filter(t => /账号|登录|存档/.test(t));
  const acctBtn = [...document.querySelectorAll('.wenv button')].map(b => b.textContent.trim()).find(t => /账号|注册/.test(t));
  const saved = window.DSHAccount.current();
  const put = window.DSHAccount.savePut('zombie-survival', 'demo-slot', { day: S.day, hp: S.hp, note: 'from game' });
  const read = window.DSHAccount.saveGet('zombie-survival', 'demo-slot');
  return {
    hasLib: typeof window.DSHAccount === 'object',
    v4account: typeof window.V4Account === 'object',
    user: saved && saved.name, providers: saved && saved.providers,
    acctBtn, acctHint,
    mapCells: document.querySelectorAll('.wcell').length,
    day: S.day, putOk: put.ok, readNote: read && read.note,
    mainSlot: window.DSHAccount.saveGet('zombie-survival', 'main') ? '在（大厅写的存档游戏里读到了）' : '不在',
  };
});
/* 游戏内面板：文件导入/导出按钮要在，微软按钮要消失，绑定前要先弹权限披露 */
out.steps.gamePanel = await ev(() => {
  window.closeAllModals();
  window.V4Account.open();
  const btns = [...document.querySelectorAll('.overlay button, .modal button')].map(b => b.textContent.trim());
  const out = {
    buttons: btns,
    hasExportFile: btns.some(t => /导出存档文件/.test(t)),
    hasImportFile: btns.some(t => /从文件导入/.test(t)),
    hasMicrosoftButton: btns.some(t => /微软/.test(t)),
    apiShape: { exportFile: typeof window.V4Account.exportFile, importFile: typeof window.V4Account.importFile, doImportFile: typeof window.V4Account.doImportFile },
  };
  /* 游戏里点「绑定 GitHub」也必须先出披露弹窗（不是直接跳授权页） */
  const bindBtn = [...document.querySelectorAll('.overlay button')].find(b => /绑定 GitHub/.test(b.textContent));
  bindBtn.click();
  const box = document.querySelector('.overlay .modal-bd, .overlay .modal');
  const txt = box ? box.innerText : '';
  out.consent = {
    title: (document.querySelector('.overlay .modal-hd h2') || {}).textContent,
    gistScope: /Gists — 读写/.test(txt),
    profileScope: /Personal user data/.test(txt),
    storageNote: /localStorage/.test(txt),
    revokeLink: /settings\/applications/.test(box ? box.innerHTML : ''),
    fileAlternative: /导出存档文件/.test(txt),
    confirmButton: [...document.querySelectorAll('.overlay button')].some(b => /我明白，继续授权/.test(b.textContent)),
  };
  return out;
});
out.steps.gameFileExport = await (async () => {
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.evaluate(() => window.V4Account.exportFile()),
    ]);
    return { name: dl.suggestedFilename(), ok: true };
  } catch (e) { return { ok: false, err: e.message.slice(0, 60) }; }
})();
/* 游戏里点开账号面板截图 */
await ev(() => { window.closeAllModals(); window.V4Account.open(); });
await page.waitForTimeout(400);
out.shots = { panel: dir + '/game-account-panel.png' };
await page.screenshot({ path: out.shots.panel, fullPage: true });
await ev(() => window.closeAllModals());
{
  await page.goto(site + '/games/', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.click('#btn-acct');
  await page.waitForTimeout(400);
  out.shots.hub = dir + '/hub-account.png';
  await page.screenshot({ path: out.shots.hub, fullPage: true });
}

/* ⑧ 收尾前：微软按钮在未配 clientId 时必须隐藏；存档文件导出/导入要走通 */
out.steps.msHidden = await ev(() => {
  const btns = [...document.querySelectorAll('#mo-bd button')].map(b => b.textContent.trim());
  const hints = [...document.querySelectorAll('#mo-bd .hint')].map(e => e.textContent.trim());
  return { buttons: btns, hasMicrosoftButton: btns.some(t => /微软/.test(t)),
    hasMicrosoftNote: hints.some(t => /微软登录暂不提供|信用卡/.test(t)) };
});
const tmpSave = 'E:/Files/Games/ZombieSurvival/docs/_m8_import_test.json';
writeFileSync(tmpSave, JSON.stringify({
  v: 1, exportedAt: new Date().toISOString(), account: { name: 'tester' },
  saves: { 'zombie-survival': { 'from-file': { day: 42, hp: 7, note: 'imported from file' } } },
}), 'utf8');
out.steps.fileRoundTrip = await (async () => {
  let downloadName = '', bytes = 0;
  try {
    // 必须"先挂监听再点击"，否则下载事件可能在 click 返回前就发完了（第一版就是这么踩空的）
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 8000 }),
      page.click('button:has-text("导出存档文件")'),
    ]);
    downloadName = dl.suggestedFilename();
    bytes = await dl.createReadStream().then(s => new Promise((res, rej) => { let n = 0; s.on('data', c => n += c.length); s.on('end', () => res(n)); s.on('error', rej); }));
  } catch (e) { downloadName = 'ERR:' + e.message.slice(0, 60); }
  await page.click('button:has-text("从文件导入")');
  await page.waitForTimeout(300);
  await page.setInputFiles('#i-file', tmpSave);
  await page.click('button:has-text("导入")');
  await page.waitForTimeout(600);
  const back = await ev(() => ({
    slot: window.DSHAccount.saveGet('zombie-survival', 'from-file'),
    slots: window.DSHAccount.slots('zombie-survival').map(s => s.slot),
  }));
  return { downloadName, bytes, importedNote: back.slot && back.slot.note, importedDay: back.slot && back.slot.day, slots: back.slots };
})();

/* ⑨ 收尾：把探针造的本地账号清掉（不留垃圾在测试浏览器 profile 里） */
out.steps.cleanup = await ev(async () => {
  const r = window.DSHAccount.deleteAccount('tester');
  return { ok: r.ok, remainingAccounts: Object.keys(localStorage).filter(k => /dsh\./.test(k)) };
});

writeFileSync('E:/Files/Games/ZombieSurvival/docs/_m8_account_probe.json', JSON.stringify(out, null, 1), 'utf8');
await browser.close();
console.log(JSON.stringify({ hub: out.steps.hub && out.steps.hub.games, errors: out.errors }, null, 1));
