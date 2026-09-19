// M61 取证：材料/等级缺口"一眼可辨"（用户：「还差…太暗了」「缺什么材料、几级工作台不够明显」）
//   ① 制作页：缺料 → 红 ⛔ 徽章 + 一行高亮"还差 …"；没建站 → 黄 🔒 徽章 + "需要先建"；等级不够 → "现在 Lv.N"
//   ② 据点页：设施卡与"该建什么"都有一行高亮缺口；材料够时变绿 ✅
//   ③ 对比度：高亮行/缺口徽章的**计算色**明显亮于背景灰字（不是"暗上加暗"），且带边框与底色
//   ④ 够料的那条配方仍然是绿色 ✅（不能把"够"也染成红的）
//   ⑤ 0 未捕获异常 + 截图
// 用法：node docs/_m61_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
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
/** 亮度粗算（把 rgb 加权成 0~255 的"看起来多亮"） */
const lum = (rgb) => { const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(String(rgb)); return m ? 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3] : -1 }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait(); await sleep(900)
/* 固定一个"缺口齐全"的存档：工作台没建（没建站 + 等级不够两条都出得来）、材料只够做绷带那条 */
await ev(`(() => {
  try { localStorage.setItem('dsh.tutorial.done','1'); localStorage.removeItem('zsv-lab-v1'); localStorage.removeItem('dsh.mapmode'); } catch(e){}
  closeAllModals(); S.over = false; S.day = 9; S.tab = 'craft';
  S.base = Object.assign({}, S.base, { bench: 1, loading: 0, medlab: 0, kitchen: 0, power: 0, filter: 0, garden: 0, storage: 1, trap: 0 });
  S.mat = 4; S.ap = 12;
  S.inv = { cloth: 2, wood: 2, metal: 1, chem: 0, bottle: 0, fuel: 0, bandage: 0, water: 2, can: 1 };
  render(); return 1
})()`)
await sleep(900)

/* ── ① 制作页 ── */
const craft = JSON.parse(await ev(`(() => {
  setTab('craft');
  const view = document.getElementById('view');
  const t = (view.textContent || '').replace(/\\s+/g, ' ');
  const shorts = [...view.querySelectorAll('.tag.short')];
  const gates = [...view.querySelectorAll('.tag.gate')];
  const eqs = [...view.querySelectorAll('.tag.eq')];
  const miss = [...view.querySelectorAll('.reqmiss')];
  const btnDisabled = [...view.querySelectorAll('button[disabled]')].map(b => b.textContent.trim());
  const cs1 = miss[0] ? getComputedStyle(miss[0]) : null;
  const cs2 = shorts[0] ? getComputedStyle(shorts[0]) : null;
  const hint = view.querySelector('.hint');
  return JSON.stringify({
    missCount: miss.length, shortCount: shorts.length, gateCount: gates.length, eqCount: eqs.length,
    shortText: shorts.slice(0, 3).map(e => e.textContent.trim()), gateText: gates.slice(0, 3).map(e => e.textContent.trim()),
    missText: miss.slice(0, 3).map(e => e.textContent.trim()),
    missAllKinds: Array.from(new Set(miss.map(e => e.textContent.trim().replace(/[^：:]*$/, '')))).slice(0, 6),
    hasShortWord: /还差/.test(t) && /材料不够/.test(t),
    hasGateWord: /需要先建/.test(t),
    lvGate: /等级不够：需要 Lv\\.\\d+，现在 Lv\\.\\d+/.test(t),
    btnDisabled: btnDisabled.slice(0, 4),
    missColor: cs1 ? cs1.color : null, missBg: cs1 ? cs1.backgroundColor : null, missBorder: cs1 ? cs1.borderLeftColor : null,
    shortColor: cs2 ? cs2.color : null, shortBg: cs2 ? cs2.backgroundColor : null,
    hintColor: hint ? getComputedStyle(hint).color : null,
  });
})()`))
console.log('  制作页: ' + JSON.stringify(craft).slice(0, 460))
ok('① 缺料是红 ⛔ 徽章（不是灰 .tag）', craft.shortCount >= 1 && craft.shortText.every(x => /⛔/.test(x)), JSON.stringify(craft.shortText))
ok('① 没建站/等级不够是黄 🔒 徽章', craft.gateCount >= 1 && craft.gateText.some(x => /需要先建/.test(x)), JSON.stringify(craft.gateText))
ok('① 缺口有单独一行高亮：材料缺什么 / 哪级什么站',
  craft.missCount >= 2 && craft.hasShortWord && craft.hasGateWord && craft.lvGate && craft.missText.some(x => /还差/.test(x)),
  JSON.stringify({ miss: craft.missText.slice(0, 2), lvGate: craft.lvGate }))
ok('① 够料的条目仍然是绿的 ✅（不能把"够"也染红）', craft.eqCount >= 1, 'eq=' + craft.eqCount)
ok('③ 高亮行比正文灰字明显亮（带边框与底色，不是暗上加暗）',
  lum(craft.missColor) > lum(craft.hintColor) + 40 && !/rgba\(0, 0, 0, 0\)/.test(craft.missBg) && !/rgba\(0, 0, 0, 0\)/.test(craft.missBorder),
  `miss ${craft.missColor}(${lum(craft.missColor).toFixed(0)}) vs hint ${craft.hintColor}(${lum(craft.hintColor).toFixed(0)}) · bg ${craft.missBg}`)
ok('③ 缺口徽章也有自己的底色（不靠字体颜色硬撑）', lum(craft.shortColor) > lum(craft.hintColor) + 40 && !/rgba\(0, 0, 0, 0\)/.test(craft.shortBg),
  `short ${craft.shortColor}(${lum(craft.shortColor).toFixed(0)}) bg ${craft.shortBg}`)
await shot('01_craft_gap')

/* ── ② 据点页 ── */
const base = JSON.parse(await ev(`(() => {
  setTab('base');
  const view = document.getElementById('view');
  const t = (view.textContent || '').replace(/\\s+/g, ' ');
  const miss = [...view.querySelectorAll('.reqmiss')];
  const cards = [...view.querySelectorAll('.card')].filter(c => /净水装置|工作台|储物箱/.test(c.textContent || ''));
  const cardTxt = cards.map(c => (c.textContent || '').replace(/\\s+/g, ' '));
  const shorts = [...view.querySelectorAll('.tag.short')];
  const cs = miss[0] ? getComputedStyle(miss[0]) : null;
  return JSON.stringify({ missCount: miss.length, shorts: shorts.length, hasMiss: /还差/.test(t),
    cardMiss: cardTxt.filter(x => /还差/.test(x)).length, cards: cardTxt.length,
    color: cs ? cs.color : null, bg: cs ? cs.backgroundColor : null,
    sample: (cardTxt.find(x => /还差/.test(x)) || '').slice(0, 150) });
})()`))
console.log('  据点页: ' + JSON.stringify(base).slice(0, 400))
ok('② 据点设施卡都有高亮缺口行（写清还差什么 ×几）', base.missCount >= 3 && base.cardMiss >= 3 && /还差/.test(base.sample), JSON.stringify({ n: base.missCount, cards: base.cardMiss, sample: base.sample }))
ok('② 据点页缺料也是红徽章（同一套视觉语言）', base.shorts >= 2, 'short=' + base.shorts)
await shot('02_base_gap')

/* ── ②b 材料够 → 变绿 ✅（同一张卡的正反两态） ── */
const flip = JSON.parse(await ev(`(() => {
  S.mat = 60; S.inv = Object.assign({}, S.inv, { metal: 9, wood: 9, cloth: 9, chip: 6, tape: 6, chem: 4, bottle: 4, fuel: 4 });
  render();
  const view = document.getElementById('view');
  const okRows = [...view.querySelectorAll('.reqmiss.ok')].map(e => e.textContent.trim());
  const shorts = view.querySelectorAll('.reqmiss:not(.ok)').length;
  const cs = okRows.length ? getComputedStyle(view.querySelector('.reqmiss.ok')) : null;
  return JSON.stringify({ okRows: okRows.slice(0, 3), okCount: okRows.length, badCount: shorts, color: cs ? cs.color : null, bg: cs ? cs.backgroundColor : null });
})()`))
console.log('  反转: ' + JSON.stringify(flip))
ok('② 材料够了：同一位置变绿 ✅「材料够，可以开工」', flip.okCount >= 3 && flip.badCount === 0 && /材料够/.test(flip.okRows[0] || ''),
  JSON.stringify(flip.okRows.slice(0, 2)))
ok('③ 绿色态与红色态视觉上分得开（颜色/底色都不是同一个）',
  lum(flip.color) > 90 && flip.bg !== base.bg, `ok ${flip.color} bg ${flip.bg} vs miss bg ${base.bg}`)
await shot('03_base_ok')

ok('⑤ 0 未捕获异常', errs.length === 0, errs.slice(0, 3).join(' | '))
const pass = checks.filter(([, c]) => c).length
console.log(`\nM61 探针：${pass}/${checks.length}`)
process.exit(pass === checks.length ? 0 : 1)
