// M44 取证：把多余的东西卖回给商人（用户：「可以让用户将自己的多余物品出售给商人（收购价格比购买价格更低）」）
//   ① 商人弹窗多了「💰 卖」页签；卖页只列"能卖的"（剧情道具 / 独一份 / 身上穿的不进列表）
//   ② 「卖1」按 45% 成交：材料涨、背包减、日志留痕
//   ③ 「全卖×N」把这一种清空；清空后那一行从列表里消失
//   ④ 买进来再卖回去一定亏（同一天同一件：回收价 < 售价）
//   ⑤ 批量出售**先弹确认框**：没点确认之前材料与背包一件都不许动；点「再想想」不成交；点「确认全卖」按清单总额成交
//   ⑥ 买页签没被这次改动弄坏（M39 的「买满×N」还在）；0 未捕获异常
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
/** 弹窗里按文本找按钮（点击会 render() 重建 DOM → 每次都要重新查） */
const clickText = (sel, re) => `(() => {
  const el = [...document.querySelectorAll('#overlay-root ${sel}')].find(b => ${re}.test(b.textContent.trim()));
  if (!el) return 'NO-BTN';
  el.click(); return el.textContent.trim();
})()`

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await ev(`(() => { if (!localStorage.getItem('zombie_survival_save_v2')) { try { saveGame(true); } catch (e) {} } return 1 })()`)
await sleep(400)

/* ───────── ① 摆好状态并打开商人：卖页签 / 只列能卖的 ───────── */
const opened = JSON.parse(await ev(`(() => {
  closeAllModals(); clearLog();
  S.over = false; S.day = 20; S.mat = 200;
  S.inv = { cloth: 4, metal: 2, bandage: 1, medkit: 1, a9_fmj: 15, keycard: 1, hk_m14: 1, cigar_x: 0 };
  S.eq.wpn = 'pistol'; S.inv.pistol = 2;
  S.shop = { day: S.day, bought: {} };
  setTab('explore');
  openMerchant();
  const tabs = [...document.querySelectorAll('#overlay-root .modal .row button')].map(b => b.textContent.trim());
  return JSON.stringify({ tabs, rate: merchantRate(), title: (document.querySelector('#overlay-root .modal-hd h2') || {}).textContent });
})()`))
await sleep(700)
ok('商人弹窗里有「🛒 买 / 💰 卖」两个页签', opened.tabs.some(t => /买/.test(t)) && opened.tabs.some(t => /卖/.test(t)), JSON.stringify({ tabs: opened.tabs, rate: opened.rate }))

const sellView = JSON.parse(await ev(`(async () => {
  ${clickText('.row button', '/💰 卖/')};
  await new Promise(r => setTimeout(r, 500));
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const names = rows.map(r => (r.querySelector('.nm') || {}).textContent || '');
  const cloth = rows.find(r => /布料/.test(r.textContent));
  return JSON.stringify({
    names: names.map(n => n.replace(/\\s+/g, ' ').trim()),
    clothBtns: cloth ? [...cloth.querySelectorAll('button')].map(b => b.textContent.trim()) : [],
    hasKey: names.some(n => /门禁卡/.test(n)),
    hasUnique: names.some(n => /M14/.test(n)),
    hasPistol: names.some(n => /手枪/.test(n)),
    batch: [...document.querySelectorAll('#overlay-root .modal button')].map(b => b.textContent.trim()).filter(t => /全卖/.test(t) || /卖掉所有能卖的|把这一类全卖/.test(t)),
    unit: sellValue('cloth', 1, merchantRate(), ITEMS),
    all: sellValue('cloth', 4, merchantRate(), ITEMS),
  });
})()`))
await sleep(500)
ok('卖页列出能卖的东西（布料/绷带/急救包/弹药都在）', ['布料', '绷带', '急救包', '9mm FMJ'].every(k => sellView.names.some(n => n.indexOf(k) >= 0)), JSON.stringify(sellView.names))
ok('剧情道具不在收购列表（门禁卡）', !sellView.hasKey && /命根子/.test(await ev(`sellBlockReason('keycard', ITEMS)`)))
ok('独一份的东西不在收购列表（同伴给的 M14）', !sellView.hasUnique && /没了|拿不回来/.test(await ev(`sellBlockReason('hk_m14', ITEMS)`)))
ok('身上拿着的武器不在收购列表（背包里那 2 把手枪一把都不给卖）', !sellView.hasPistol && (await ev(`merchantEquipped()`)).join(',').indexOf('pistol') >= 0)
ok('每一行都有「卖1（+N）」和「全卖×N（+M）」，回收费 = 买价的 45%', sellView.clothBtns.some(t => t === '卖1（+' + sellView.unit + '）') && sellView.clothBtns.some(t => t === '全卖×4（+' + sellView.all + '）'), JSON.stringify({ btns: sellView.clothBtns, unit: sellView.unit, all: sellView.all }))
ok('底部有批量出售按钮（跟随筛选，带合计）', sellView.batch.some(t => /卖掉所有能卖的|把这一类全卖/.test(t) && /\+\d+ 材料/.test(t)), JSON.stringify(sellView.batch.slice(0, 4)))
await shot('01_sell_tab')

/* ───────── ② 「卖1」真成交 ───────── */
const one = JSON.parse(await ev(`(async () => {
  const before = { mat: S.mat, cloth: S.inv.cloth };
  const r = await (async () => {
    const row = [...document.querySelectorAll('#overlay-root .lrow')].find(x => /布料/.test(x.textContent));
    const btn = [...row.querySelectorAll('button')].find(b => /^卖1（/.test(b.textContent.trim()));
    const label = btn.textContent.trim();
    btn.click();
    await new Promise(r2 => setTimeout(r2, 500));
    return label;
  })();
  return JSON.stringify({ before, label: r, mat: S.mat, cloth: S.inv.cloth, log: (S.logBuf || []).slice(-1).map(p => p[1]).join('') });
})()`))
await sleep(400)
ok('点「卖1」：材料按回收价涨、背包少 1 件、日志写明', one.mat === one.before.mat + sellView.unit && one.cloth === one.before.cloth - 1 && /卖掉 布料 ×1/.test(one.log), JSON.stringify(one))

/* ───────── ③ 「全卖×N」清空这一种 ───────── */
const all3 = JSON.parse(await ev(`(async () => {
  const row = [...document.querySelectorAll('#overlay-root .lrow')].find(x => /布料/.test(x.textContent));
  const btn = [...row.querySelectorAll('button')].find(b => /^全卖×/.test(b.textContent.trim()));
  const label = btn.textContent.trim();
  const before = { mat: S.mat, cloth: S.inv.cloth || 0, expect: sellValue('cloth', S.inv.cloth || 0, merchantRate(), ITEMS) };
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  const after = { mat: S.mat, cloth: S.inv.cloth || 0, listed: [...document.querySelectorAll('#overlay-root .lrow')].some(x => /布料/.test(x.textContent)) };
  return JSON.stringify({ before, label, after });
})()`))
await sleep(400)
ok('点「全卖×N」：这一种全清、材料按整批回收价到账', all3.after.cloth === 0 && all3.after.mat === all3.before.mat + all3.before.expect && all3.before.expect > 0, JSON.stringify(all3))
ok('卖光的物品从收购列表里消失', !all3.after.listed, JSON.stringify({ listed: all3.after.listed }))

/* ───────── ④ 买进来再卖回去一定亏 ───────── */
const flip = JSON.parse(await ev(`(async () => {
  const i = MERCHANT.findIndex(m => m.id === 'medkit');
  const rate = merchantRate();
  const before = S.mat;
  buyMerchant(i);                                   // 买 1 个急救包
  await new Promise(r => setTimeout(r, 400));
  const afterBuy = S.mat;
  setMerchantTab('sell');
  await new Promise(r => setTimeout(r, 400));
  const row = [...document.querySelectorAll('#overlay-root .lrow')].find(x => /急救包/.test(x.textContent));
  const btn = [...row.querySelectorAll('button')].find(b => /^卖1（/.test(b.textContent.trim()));
  btn.click();
  await new Promise(r => setTimeout(r, 500));
  return JSON.stringify({ rate, before, afterBuy, afterSell: S.mat, buyCost: shopPrice({ id: 'medkit', cost: 34 }, rate), back: sellValue('medkit', 1, rate, ITEMS), week: S.day });
})()`))
await sleep(400)
ok('同一天同一件：买价 > 回收价（买回来再卖出去是亏的）', flip.buyCost > flip.back && flip.afterBuy === flip.before - flip.buyCost && flip.afterSell === flip.afterBuy + flip.back && flip.afterSell < flip.before, JSON.stringify(flip))

/* ───────── ⑤ 批量出售：先确认、再成交 ───────── */
const beforeBatch = JSON.parse(await ev(`(async () => {
  closeAllModals(); clearLog();
  S.mat = 100;
  S.inv = { metal: 3, bandage: 2, medkit: 1, keycard: 1 };
  S.shop = { day: S.day, bought: {} };
  S.eq = { wpn: null, head: null, body: null, mask: null, feet: null, trinket: null, bag: null };
  openMerchant(); setMerchantTab('sell');
  await new Promise(r => setTimeout(r, 500));
  const btn = [...document.querySelectorAll('#overlay-root .modal button')].find(b => /卖掉所有能卖的|把这一类全卖/.test(b.textContent) && /材料/.test(b.textContent));
  const label = btn ? btn.textContent.trim() : 'NO-BTN';
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 500));
  const heads = [...document.querySelectorAll('#overlay-root .modal-hd h2')];
  const head = (heads[heads.length - 1] || {}).textContent || '';      // 最上面那个弹窗（确认框）的标题
  const confirmBtn = [...document.querySelectorAll('#overlay-root .modal button')].map(b => b.textContent.trim()).find(t => /确认全卖/.test(t)) || '';
  return JSON.stringify({ label, head, confirmBtn, mat: S.mat, inv: JSON.parse(JSON.stringify(S.inv)), modals: modalStack.length,
    expected: sellBatchPlan(Object.keys(S.inv), S.inv, { rate: merchantRate(), items: ITEMS, equipped: [] }).total });
})()`))
await sleep(500)
ok('点批量出售先弹确认框（写着这批是什么、几件、换多少）', /确认出售/.test(beforeBatch.head) && /\+\d+ 材料/.test(beforeBatch.confirmBtn), JSON.stringify({ head: beforeBatch.head, confirmBtn: beforeBatch.confirmBtn }))
ok('确认之前一件都没成交（材料与背包原样、弹窗还叠着）', beforeBatch.mat === 100 && beforeBatch.inv.metal === 3 && beforeBatch.modals >= 2, JSON.stringify({ mat: beforeBatch.mat, inv: beforeBatch.inv, modals: beforeBatch.modals }))
await shot('02_batch_confirm')

const cancel = JSON.parse(await ev(`(async () => {
  ${clickText('.modal button', '/再想想/')};
  await new Promise(r => setTimeout(r, 500));
  return JSON.stringify({ mat: S.mat, inv: JSON.parse(JSON.stringify(S.inv)), modals: modalStack.length });
})()`))
await sleep(300)
ok('点「再想想」= 不成交，弹窗回到商人页', cancel.mat === 100 && cancel.inv.metal === 3 && cancel.modals === 1, JSON.stringify(cancel))

const confirmGo = JSON.parse(await ev(`(async () => {
  const batchBtn = [...document.querySelectorAll('#overlay-root .modal button')].find(b => /卖掉所有能卖的|把这一类全卖/.test(b.textContent) && /材料/.test(b.textContent));
  const quote = batchBtn.textContent.match(/\\+(\\d+) 材料/);
  batchBtn.click();
  await new Promise(r => setTimeout(r, 500));
  const quoted = Number(([...document.querySelectorAll('#overlay-root .modal button')].map(b => b.textContent.trim()).find(t => /确认全卖/.test(t)) || '').match(/\\+(\\d+)/)?.[1] || -1);
  const mat0 = S.mat;
  ${clickText('.modal button', '/确认全卖/')};
  await new Promise(r => setTimeout(r, 600));
  return JSON.stringify({ quoted, quotedBtn: quote ? Number(quote[1]) : -1, mat0, mat: S.mat, inv: JSON.parse(JSON.stringify(S.inv)),
    log: (S.logBuf || []).slice(-1).map(p => p[1]).join(''), rows: [...document.querySelectorAll('#overlay-root .lrow')].length });
})()`))
await sleep(500)
ok('点「确认全卖」：到账 = 确认单上写的数（报价锁定，不在结算途中改价）', confirmGo.quoted === confirmGo.quotedBtn && confirmGo.mat === confirmGo.mat0 + confirmGo.quoted && confirmGo.quoted > 0, JSON.stringify(confirmGo))
ok('批量卖掉的东西从背包里清了（剧情道具原封不动）', !confirmGo.inv.metal && !confirmGo.inv.bandage && !confirmGo.inv.medkit && confirmGo.inv.keycard === 1, JSON.stringify(confirmGo.inv))
ok('日志写明"一次卖掉 N 种 · M 件"', /一次卖掉 \d+ 种 · \d+ 件/.test(confirmGo.log), confirmGo.log)
await shot('03_batch_done')

/* ───────── ⑥ 买页签回归（M39 的批量购买还在） ───────── */
const buyTab = JSON.parse(await ev(`(async () => {
  closeAllModals(); clearLog();
  S.mat = 300; S.shop = { day: S.day, bought: {} };
  S.inv = { cloth: 1 };
  openMerchant();
  setMerchantTab('buy');                            // 上一步停在卖页，先切回买页（这也是页签本身的一次回归）
  await new Promise(r => setTimeout(r, 500));
  const rows = [...document.querySelectorAll('#overlay-root .lrow')];
  const ammo = rows.find(r => /9mm FMJ/.test(r.textContent));
  const btns = ammo ? [...ammo.querySelectorAll('button')].map(b => b.textContent.trim()) : [];
  const each = shopPrice(MERCHANT.find(m => m.id === 'a9_fmj'), merchantRate());   // 成交会涨交易技能 → 汇率会跟着降，单价必须在点之前取
  const before = { mat: S.mat, ammo: S.inv.a9_fmj || 0 };
  const b = ammo ? [...ammo.querySelectorAll('button')].find(x => /^买满×\\d+$/.test(x.textContent.trim())) : null;
  if (b) b.click();
  await new Promise(r => setTimeout(r, 500));
  return JSON.stringify({ btns, before, mat: S.mat, ammo: S.inv.a9_fmj || 0, each });
})()`))
await sleep(400)
ok('买页签没坏：弹药行仍有「购买 + 买满×N」，点一下照旧成交', buyTab.btns.some(t => /^买满×\d+$/.test(t)) && buyTab.ammo === 45 && buyTab.before.mat - buyTab.mat === buyTab.each * 3, JSON.stringify(buyTab))
await shot('04_buy_tab_regression')

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
