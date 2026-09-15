// M39 取证：QoL 第二批（商人批量购买 + 口令加密导出/导入 + 备份历史）
//   ① 货架上每行按"材料/今日库存"实时给出 ×N 与 买满×M；点一下真的按份数成交（扣款/进包/扣库存都对）
//   ② 材料只够几份时按买得起的份数成交，并把原因写在日志里；售罄行按钮禁用
//   ③ 导出：生成 ZSVEXP1 文本、不含明文痕迹、体量提示；口令太短被拦
//   ④ 导入：口令对 → 预览第几天 → 覆盖本机进度；口令错 → 人话报错
//   ⑤ 备份历史：立即快照 / 天数变化必存 / 密文落盘 / 回滚到指定一份 / 删除
//   ⑥ 0 未捕获异常
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const BOOT = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'dev=ready'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const bootWait = async (tries = 30) => {
  for (let i = 0; i < tries; i++) {
    const r = await ev(`(() => (typeof S === 'object' && !!S && typeof closeAllModals === 'function' && !!document.getElementById('view')) ? 1 : 0)()`)
    if (r === 1) return true
    await sleep(800)
  }
  return false
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(400)

/* ───────── ① 商人批量购买 ───────── */
const shop = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  S.over = false; S.day = 20; S.mat = 300; S.ap = S.apMax;
  S.inv = {}; S.eq.wpn = 'pistol'; S.inv.pistol = 1;
  S.shop = { day: S.day, bought: {} };
  openMerchant();
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const ammo = rows.find(r => /9mm FMJ/.test(r.textContent));
  return JSON.stringify({
    rate: merchantRate(),
    ammoText: ammo ? ammo.textContent.replace(/\\s+/g, ' ').trim() : 'NO-ROW',
    ammoBtns: ammo ? [...ammo.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
    mat: S.mat,
  });
})()`))
await sleep(800)
ok('弹药行有「购买 + 买满×N」批量按钮（份数实时算）', shop.ammoBtns.length >= 2 && shop.ammoBtns.some(t => /^买满×\d+$/.test(t)), JSON.stringify(shop.ammoBtns))
// 300 材料 / 9mm FMJ(28×rate) → 每份价 = round(28*rate)；库存 3 → 买满×3
const expectEach = Math.max(1, Math.round(28 * shop.rate))
ok('买满份数 = min(今日库存 3, 材料买得起的份数)', /买满×3/.test(shop.ammoBtns.join(' ')), JSON.stringify({ rate: shop.rate, each: expectEach, btns: shop.ammoBtns }))
await shot('01_merchant_batch')

const buyMax = JSON.parse(await ev(`(() => {
  const before = { mat: S.mat, ammo: S.inv.a9_fmj || 0, bought: (S.shop.bought.a9_fmj || 0), left: shopLeft(MERCHANT.find(m => m.id === 'a9_fmj')) };
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const ammo = rows.find(r => /9mm FMJ/.test(r.textContent));
  const btn = [...ammo.querySelectorAll('button')].find(b => /^买满×3$/.test(b.textContent.trim()));
  btn.click();
  return JSON.stringify({ before, mat: S.mat, ammo: S.inv.a9_fmj || 0, bought: (S.shop.bought.a9_fmj || 0),
    left: shopLeft(MERCHANT.find(m => m.id === 'a9_fmj')), log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(1000)
const each = expectEach, per = 15
ok('点「买满×3」：材料按 3 份扣、弹药进包 45 发、库存卖光', buyMax.mat === buyMax.before.mat - each * 3 && buyMax.ammo === 45 && buyMax.left === 0, JSON.stringify(buyMax))
ok('购买计数按份数走（当天限购 3 份 → bought=3）', buyMax.bought === 3, JSON.stringify({ bought: buyMax.bought, each, per }))
ok('日志写明份数与总价', /买满|×45/.test(buyMax.log) || /3 份/.test(buyMax.log), buyMax.log)

const soldOut = JSON.parse(await ev(`(() => {
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const ammo = rows.find(r => /9mm FMJ/.test(r.textContent));
  const btns = [...ammo.querySelectorAll('button')].map(b => ({ t: b.textContent.trim(), d: b.disabled }));
  return JSON.stringify({ btns });
})()`))
ok('卖完后主按钮变「今日售罄」且禁用、批量按钮消失', soldOut.btns.some(b => /今日售罄/.test(b.t) && b.d) && !soldOut.btns.some(b => /买满/.test(b.t)), JSON.stringify(soldOut.btns))

const partial = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  const each = shopPrice(MERCHANT.find(m => m.id === 'a9_fmj'), merchantRate());
  S.mat = each * 2 + 1;                                                  // 只买得起 2 份
  S.shop = { day: S.day, bought: {} };
  const mat0 = S.mat, ammo0 = S.inv.a9_fmj || 0;
  openMerchant();
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const ammo = rows.find(r => /9mm FMJ/.test(r.textContent));
  const btn = [...ammo.querySelectorAll('button')].find(b => /^买满×\\d+$/.test(b.textContent.trim()));
  const label = btn ? btn.textContent.trim() : 'NO-BTN';
  if (btn) btn.click();
  return JSON.stringify({ each, label, before: { mat: mat0, ammo: ammo0 }, mat: S.mat, ammo: S.inv.a9_fmj || 0, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(900)
ok('材料只够 2 份时「买满×2」按 2 份成交（扣 2 份钱、进 30 发）', /买满×2/.test(partial.label) && partial.ammo === partial.before.ammo + 30 && partial.mat === partial.before.mat - partial.each * 2, JSON.stringify(partial))

const reason = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  S.mat = 5; S.shop = { day: S.day, bought: {} };                        // 一份都买不起
  const idx = MERCHANT.findIndex(m => m.id === 'a9_fmj');
  buyMerchant(idx, 5);
  return JSON.stringify({ mat: S.mat, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(500)
ok('材料不够时一份都不成交，并说清楚原因', reason.mat === 5 && /材料不够/.test(reason.log), JSON.stringify(reason))

/* ───────── ② 读档不白送弹药（M39 顺手修的 P0） ─────────
   根因：sanitizeSave 把 save.ammo > 0 当"旧版弹药池"折进背包，而 M32b 之后它是"装填镜像"，
   存档里天然正数 → 刷新一次弹药翻倍（实测 100 → 200 → 400）。 */
const ammoSave = JSON.parse(await ev(`(() => {
  closeAllModals(); S.eq.wpn = 'pistol'; S.inv.pistol = 1; S.inv.a9_fmj = 100; syncAmmo(); autosave();
  return JSON.stringify({ inv: S.inv.a9_fmj, mirror: S.ammo, saved: JSON.parse(V4Vault.currentPlain()).inv.a9_fmj });
})()`))
await sleep(1200)
await send('Page.navigate', { url: BOOT }); await bootWait()
const ammoAfter1 = JSON.parse(await ev(`(() => JSON.stringify({ inv: S.inv.a9_fmj, mirror: S.ammo }))()`))
await send('Page.navigate', { url: BOOT }); await bootWait()
const ammoAfter2 = JSON.parse(await ev(`(() => JSON.stringify({ inv: S.inv.a9_fmj, mirror: S.ammo }))()`))
ok('刷新一次弹药不翻倍（存档里的装填镜像不再被当成"旧版弹药池"）', ammoSave.inv === 100 && ammoAfter1.inv === 100 && ammoAfter2.inv === 100, JSON.stringify({ saved: ammoSave, r1: ammoAfter1, r2: ammoAfter2 }))
ok('镜像与背包始终一致（HUD 不会显示 0 发）', ammoAfter2.mirror === ammoAfter2.inv, JSON.stringify(ammoAfter2))

/* ───────── ③ 口令加密导出/导入 ───────── */
const menuBtn = JSON.parse(await ev(`(() => {
  closeAllModals(); S.mat = 200; openMenu();
  const labels = [...document.querySelectorAll('#overlay-root button')].map(b => b.textContent.trim());
  return JSON.stringify({ hasPort: labels.some(t => /导出 \\/ 导入（口令）/.test(t)), hasHist: labels.some(t => /备份历史/.test(t)), labels: labels.filter(t => /存档|导出|备份|口令/.test(t)) });
})()`))
await sleep(700)
ok('菜单里有「🔐 导出 / 导入（口令）」与「🗂️ 备份历史」入口', menuBtn.hasPort && menuBtn.hasHist, JSON.stringify(menuBtn.labels))
const clickedPort = await ev(`(() => {
  const b = [...document.querySelectorAll('#overlay-root button')].find(b => /导出 \\/ 导入（口令）/.test(b.textContent));
  if (!b) return 'NO-BTN';
  b.click(); return 'clicked';
})()`)
await sleep(900)
ok('点菜单按钮能打开口令弹窗（真点击路径）', clickedPort === 'clicked', clickedPort)
await shot('02_save_port')

const exported = JSON.parse(await ev(`(async () => {
  const pw = document.getElementById('port-pw');
  pw.value = 'probe-passphrase-2026';
  document.getElementById('port-gen').click();
  await new Promise(r => setTimeout(r, 1200));
  const txt = document.getElementById('port-out').value;
  return JSON.stringify({ len: txt.length, head: txt.slice(0, 9), size: document.getElementById('port-size').textContent,
    leaksPlaintext: /\\"day\\"|savedAt|\\"inv\\"/.test(txt), day: S.day });
})()`))
await sleep(400)
ok('生成 ZSVEXP1 导出文本（含体量提示，且不含明文痕迹）', exported.head.startsWith('ZSVEXP1:') && exported.len > 200 && exported.leaksPlaintext === false, JSON.stringify({ head: exported.head, len: exported.len, size: exported.size, leak: exported.leaksPlaintext }))

const weak = JSON.parse(await ev(`(async () => {
  document.getElementById('port-pw').value = '123';
  document.getElementById('port-gen').click();
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({ msg: document.getElementById('port-msg').textContent });
})()`))
ok('口令太短直接被拦（不是等导出完才报错）', /至少 6 位/.test(weak.msg), JSON.stringify(weak))

/* 先记住导出时是第几天，再把本机进度改掉，然后导入回来。
   期望值直接从"导出用的那份明文"里读（vault 的内存缓存）——导出发生在哪一毫秒都不会错。 */
const roundTrip = JSON.parse(await ev(`(async () => {
  const txt = document.getElementById('port-out').value;
  const src = JSON.parse(V4Vault.currentPlain());
  const expect = { day: src.day, ammo: src.inv.a9_fmj || 0, mat: src.mat };
  S.day = 99; S.inv.a9_fmj = 0; S.mat = 1; render(); autosave();
  await new Promise(r => setTimeout(r, 600));
  const afterEdit = { day: S.day, ammo: S.inv.a9_fmj || 0 };
  document.getElementById('port-in').value = txt;
  document.getElementById('port-pw2').value = 'probe-passphrase-2026';
  document.getElementById('port-import').click();
  await new Promise(r => setTimeout(r, 1500));
  const confirm = [...document.querySelectorAll('#overlay-root button')].find(b => /覆盖并载入/.test(b.textContent));
  const preview = document.querySelector('#overlay-root .modal-bd') ? document.querySelector('#overlay-root .modal-bd').textContent.replace(/\\s+/g, ' ').slice(0, 200) : '';
  if (confirm) confirm.click();
  await new Promise(r => setTimeout(r, 1500));
  return JSON.stringify({ expect, afterEdit, preview, day: S.day, ammo: S.inv.a9_fmj || 0, mat: S.mat,
    log: (S.logBuf || []).slice(-2).map(p => p[1]).join(' | ') });
})()`))
await sleep(600)
ok('导入预览写的是备份里的第几天（不是当前进度）', new RegExp('第 ' + roundTrip.expect.day + ' 天').test(roundTrip.preview), roundTrip.preview.slice(0, 60))
ok('口令对 → 进度回到导出那一刻（天数/弹药/材料全对上）', roundTrip.day === roundTrip.expect.day && roundTrip.ammo === roundTrip.expect.ammo && roundTrip.mat === roundTrip.expect.mat, JSON.stringify({ expect: roundTrip.expect, got: { day: roundTrip.day, ammo: roundTrip.ammo, mat: roundTrip.mat }, edited: roundTrip.afterEdit }))
ok('导入后写了日志说明原进度已转存备份', /导入/.test(roundTrip.log), roundTrip.log)

const wrongPw = JSON.parse(await ev(`(async () => {
  const txt = (document.getElementById('port-out') && document.getElementById('port-out').value) || '';
  return JSON.stringify({ hasModal: !!document.querySelector('#overlay-root .modal-bd') });
})()`))
const wrongPwTry = JSON.parse(await ev(`(async () => {
  closeAllModals(); openSavePort();
  await new Promise(r => setTimeout(r, 600));
  const pw = document.getElementById('port-pw'); pw.value = 'another-passphrase-9';
  document.getElementById('port-gen').click();
  await new Promise(r => setTimeout(r, 1200));
  const txt = document.getElementById('port-out').value;
  document.getElementById('port-in').value = txt;
  document.getElementById('port-pw2').value = 'WRONG-passphrase-9';
  document.getElementById('port-import').click();
  await new Promise(r => setTimeout(r, 1200));
  return JSON.stringify({ msg: document.getElementById('port-msg').textContent, day: S.day });
})()`))
ok('口令错 → 人话报错且不动存档', /口令不对/.test(wrongPwTry.msg) && wrongPwTry.day === 20, JSON.stringify(wrongPwTry))
await ev(`(() => { closeAllModals(); return 1 })()`); await sleep(400)

/* ───────── ③ 备份历史 ───────── */
const hist = JSON.parse(await ev(`(async () => {
  localStorage.removeItem('zombie_survival_backups_v1');
  closeAllModals(); clearLog();
  S.day = 20; render();
  openBackupHistory();
  await new Promise(r => setTimeout(r, 500));
  const empty = document.querySelector('#overlay-root .modal-bd').textContent.replace(/\\s+/g, ' ');
  const b = document.getElementById('bak-now'); b.click();
  await new Promise(r => setTimeout(r, 1500));
  const raw = localStorage.getItem('zombie_survival_backups_v1') || '';
  let arr = []; try { arr = JSON.parse(raw); } catch (e) {}
  const rowsText = document.querySelector('#overlay-root .modal-bd').textContent.replace(/\\s+/g, ' ');
  return JSON.stringify({ empty, n: arr.length, cipher: arr[0] ? String(arr[0].text || '').slice(0, 5) : '', key: arr[0] ? arr[0].key : '',
    day: arr[0] ? arr[0].day : -1, rowsHasDay: /第 20 天/.test(rowsText), listKey: raw.length });
})()`))
await sleep(600)
ok('空历史有引导文案；点「立即存一份快照」真的落一份', hist.n === 1 && /还没有历史快照/.test(hist.empty), JSON.stringify({ n: hist.n, empty: hist.empty }))
ok('快照是密文落盘（ZSV1:）且列表里显示"第 20 天"', hist.cipher === 'ZSV1:' && hist.rowsHasDay === true, JSON.stringify({ cipher: hist.cipher, rowsHasDay: hist.rowsHasDay, key: hist.key }))
await shot('03_backup_history')

const twoSnaps = JSON.parse(await ev(`(async () => {
  /* 天数变化必须自动存一份（写盘时顺手存，节流规则不拦"过了新的一天"） */
  S.day = 21; render(); autosave();
  await new Promise(r => setTimeout(r, 1600));
  const arr = JSON.parse(localStorage.getItem('zombie_survival_backups_v1') || '[]');
  return JSON.stringify({ n: arr.length, days: arr.map(e => e.day) });
})()`))
ok('过了一天会自动多一份快照（第 21 天在最前）', twoSnaps.n === 2 && twoSnaps.days[0] === 21, JSON.stringify(twoSnaps))

const rollback = JSON.parse(await ev(`(async () => {
  S.day = 30; render(); autosave();
  await new Promise(r => setTimeout(r, 800));
  closeAllModals(); openBackupHistory();
  await new Promise(r => setTimeout(r, 700));
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const row20 = rows.find(r => /第 20 天/.test(r.textContent));
  const btn = row20 && [...row20.querySelectorAll('button')].find(b => /回滚到这份/.test(b.textContent));
  if (!btn) return JSON.stringify({ err: 'NO-BTN', rows: rows.map(r => r.textContent.replace(/\\s+/g, ' ').slice(0, 40)) });
  btn.click();
  await new Promise(r => setTimeout(r, 800));
  const go = document.getElementById('hs-go'); if (go) go.click();
  await new Promise(r => setTimeout(r, 2000));
  return JSON.stringify({ day: S.day, log: (S.logBuf || []).slice(-2).map(p => p[1]).join(' | ') });
})()`))
await sleep(600)
ok('「回滚到这份」按指定快照回滚（第 30 → 第 20 天）', rollback.day === 20, JSON.stringify(rollback))

const del = JSON.parse(await ev(`(async () => {
  closeAllModals(); openBackupHistory();
  await new Promise(r => setTimeout(r, 700));
  const before = JSON.parse(localStorage.getItem('zombie_survival_backups_v1') || '[]').length;
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const btn = rows[0] && [...rows[0].querySelectorAll('button')].find(b => /删除/.test(b.textContent));
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 700));
  const d = document.getElementById('hs-del'); if (d) d.click();
  await new Promise(r => setTimeout(r, 1200));
  const after = JSON.parse(localStorage.getItem('zombie_survival_backups_v1') || '[]').length;
  return JSON.stringify({ before, after });
})()`))
await sleep(500)
ok('删除某一份快照只少那一份', del.after === del.before - 1, JSON.stringify(del))
await ev(`(() => { closeAllModals(); return 1 })()`)

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
