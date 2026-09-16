// M50 取证：病症进「人体」页 + 真的能治 + 治疗指南进「图鉴」
//   用户原话：「为什么真菌感染没有在"人体"subpage 内显示，也无法治疗；把所有的体温啊病情啊啥的
//             都移到人体 subpage 内，然后把治疗指南（图2）移动到图鉴内」
//   ① 顶栏不再挂体温/湿度/病症 chips（搬走了）
//   ② 人体页有「🌡️ 体温与环境」与「🦠 病症」；「📖 伤情图鉴」不在人体页了
//   ③ 真菌感染在人体页显示：症状 / 代价 / 怎么好 / 药名，且**没药时按钮是禁用的**
//   ④ 点了「抗真菌药」按钮 → 病当场消失、药 -1、惩罚回落、日志写明
//   ⑤ 背包里直接「使用」抗真菌药也能治（useConsumable 这条路）
//   ⑥ 图鉴 →「📘 治疗指南」：伤情怎么处理 + 病症怎么处理（含真菌感染那条）
//   ⑦ 药拿得到：医疗台配方 / 商人货架 / 药房医院诊所掉落
//   ⑧ 全程无 console 报错；截图存 docs/_m50_shots/
// 用法：node docs/_m50_probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 140))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'))
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(3000)
await ev(`localStorage.removeItem('zombie_survival_save_v2'); sessionStorage.clear(); 1`)
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(5000)
console.log('  启动: ' + await ev(`JSON.stringify({ dev: !!window.DEV, sv: !!window.V4Survival, treat: typeof (window.V4Survival||{}).treat, guide: typeof window.__v4GuideHtml })`))
ok('v4 病症治疗入口与图鉴指南都挂上了 window',
  /"dev":true/.test(await ev(`JSON.stringify({dev:!!window.DEV})`)) &&
  (await ev(`typeof window.V4Survival.treat === 'function' && typeof window.__v4GuideHtml === 'function'`)) === true)

/* ── ① 顶栏不再挂体温/湿度/病症 ── */
const hudChips = await ev(`(() => {
  if (typeof render === 'function') render();
  const env0 = document.querySelector('.v4-env');
  return env0 ? env0.querySelectorAll('.chip').length : 0;
})()`)
ok('① 顶栏不再显示体温/湿度/病症 chips（用户要求搬进人体页）', hudChips === 0, 'chips=' + hudChips)

/* ── ②③ 人体页：体温与环境 / 病症两块在，"伤情图鉴"搬走了 ── */
const body = JSON.parse(await ev(`(() => {
  const S = DEV.state();
  /* 造一个真菌感染（玩家真实会得的路径见 _m30_probe；这里直接落到状态上，专测"显示与治疗"） */
  S.env.conds = [{ id: 'fungal', since: Math.max(1, S.day - 2), stage: 1 }];
  S.env.wet = 40;
  window.V4Survival.refreshHum();
  setTab('body');
  const view = document.querySelector('#view') || document.body;
  const txt = view.textContent.replace(/\\s+/g, ' ');
  const btns = [...view.querySelectorAll('button')].map(b => ({ t: b.textContent.replace(/\\s+/g, ' ').trim(), dis: !!b.disabled }));
  return JSON.stringify({ hasEnv: /体温与环境/.test(txt), hasCond: /病症/.test(txt), hasFungal: /真菌感染/.test(txt),
    hasSymptom: /指缝和腋下/.test(txt), hasCure: /抗真菌药/.test(txt), hasOldGuide: /伤情图鉴/.test(txt),
    hasHum: /湿度/.test(txt), hasTemp: /体温/.test(txt), btns });
})()`))
console.log('  人体页: ' + JSON.stringify({ env: body.hasEnv, cond: body.hasCond, fungal: body.hasFungal, oldGuide: body.hasOldGuide }))
ok('② 人体页有「🌡️ 体温与环境」与「🦠 病症」两块', body.hasEnv && body.hasCond && body.hasTemp && body.hasHum, JSON.stringify(body).slice(0, 200))
ok('② 「伤情图鉴」已经从人体页搬走（去图鉴了）', body.hasOldGuide === false)
ok('③ 真菌感染显示在人体页：症状 + 怎么好 + 药名', body.hasFungal && body.hasSymptom && body.hasCure)
ok('③ 没药时治疗按钮是禁用的（写着"有 0"）',
  body.btns.some(b => /抗真菌药/.test(b.t) && /有 0/.test(b.t) && b.dis === true),
  JSON.stringify(body.btns.filter(b => /抗真菌药/.test(b.t))))
await shot('01_body_cond')

/* ── ④ 给药 → 点按钮治好 ── */
const cured = JSON.parse(await ev(`(() => {
  const S = DEV.state();
  grant('fungicide', 2);
  if (typeof render === 'function') render();
  const before = { conds: window.V4Survival.status().conds.slice(), item: itemCount('fungicide'),
    cap: window.V4Survival.staCapMul(), logs: (S.logBuf || []).length };
  const btn = [...document.querySelectorAll('#view button')].find(b => /抗真菌药/.test(b.textContent || ''));
  const enabled = btn && !btn.disabled;
  if (btn) btn.click();
  const after = { conds: window.V4Survival.status().conds.slice(), item: itemCount('fungicide'),
    cap: window.V4Survival.staCapMul() };
  const logs = (S.logBuf || []).slice(-4).map(x => String(x.text || x)).join(' | ');
  return JSON.stringify({ before, after, enabled, logs });
})()`))
console.log('  治疗: ' + JSON.stringify(cured))
ok('④ 有药时按钮可点，点一下真菌感染当场消失', cured.enabled === true && cured.after.conds.length === 0,
  JSON.stringify({ enabled: cured.enabled, before: cured.before.conds, after: cured.after.conds }))
ok('④ 药真的被消耗（2 → 1）', cured.before.item === 2 && cured.after.item === 1, JSON.stringify({ b: cured.before.item, a: cured.after.item }))
ok('④ 惩罚回落（体力上限倍率 0.9 → 1）', cured.before.cap < 1 && cured.after.cap === 1, JSON.stringify({ b: cured.before.cap, a: cured.after.cap }))
ok('④ 日志写明了怎么治的', /真菌感染/.test(cured.logs) && /抗真菌药/.test(cured.logs), cured.logs.slice(0, 120))
await sleep(400)
await shot('02_body_cured')

/* ── ⑤ 背包里直接吃药也能治（useConsumable 那条路） ── */
const byBag = JSON.parse(await ev(`(() => {
  const S = DEV.state();
  S.env.conds = [{ id: 'fungal', since: S.day, stage: 2 }];
  grant('fungicide', 1);
  const before = { conds: window.V4Survival.status().conds.slice(), item: itemCount('fungicide') };
  useConsumable('fungicide');
  const after = { conds: window.V4Survival.status().conds.slice(), item: itemCount('fungicide'),
    logs: (S.logBuf || []).slice(-3).map(x => String(x.text || x)).join(' | ') };
  return JSON.stringify({ before, after });
})()`))
console.log('  背包吃药: ' + JSON.stringify(byBag))
ok('⑤ 背包里「使用」抗真菌药同样能治病（不必回人体页）',
  byBag.before.conds.length === 1 && byBag.after.conds.length === 0 && byBag.after.item === 0,
  JSON.stringify(byBag.after))

/* ── ⑥ 图鉴 → 📘 治疗指南 ── */
const guide = JSON.parse(await ev(`(() => {
  setTab('codex');
  const cats = [...document.querySelectorAll('#view button')].map(b => b.textContent.replace(/\\s+/g, ' ').trim());
  const btn = [...document.querySelectorAll('#view button')].find(b => /治疗指南/.test(b.textContent || ''));
  if (btn) btn.click();
  const txt = (document.querySelector('#view') || document.body).textContent.replace(/\\s+/g, ' ');
  const api = String(window.__v4GuideHtml ? window.__v4GuideHtml() : '');
  return JSON.stringify({ cats, clicked: !!btn, hasInjury: /伤情怎么处理/.test(txt), hasCond: /病症怎么处理/.test(txt),
    hasFungal: /真菌感染/.test(txt), hasDrug: /抗真菌药/.test(txt), hasBleed: /流血不会自己停/.test(txt),
    apiLen: api.length, bodyStillHasGuide: false });
})()`))
console.log('  图鉴: ' + JSON.stringify({ cats: guide.cats, clicked: guide.clicked, injury: guide.hasInjury, cond: guide.hasCond }))
ok('⑥ 图鉴多了「📘 治疗指南」分类按钮', guide.cats.some(c => /治疗指南/.test(c)), JSON.stringify(guide.cats))
ok('⑥ 点开后是治疗指南：伤情怎么处理 + 病症怎么处理',
  guide.clicked && guide.hasInjury && guide.hasCond && guide.hasBleed, JSON.stringify(guide).slice(0, 200))
ok('⑥ 指南里真菌感染那条写着抗真菌药', guide.hasFungal && guide.hasDrug)
await shot('03_codex_guide')

/* ── ⑦ 药拿得到：配方 / 货架 / 掉落 ── */
const src = JSON.parse(await ev(`(() => {
  const rec = (window.RECIPES || []).filter(r => r.out === 'fungicide');
  const shelf = window.MERCHANT || window.MERCHANT_GOODS || [];
  const rows = shelf.filter(r => r.id === 'fungicide');
  const loot = ['pharmacy', 'hospital', 'clinic'].map(id => ({ id, has: !!(V4.POIS[id] && V4.POIS[id].loot && V4.POIS[id].loot.fungicide) }));
  return JSON.stringify({ recipes: rec.length, recipeAt: rec[0] ? (rec[0].st + ' Lv' + rec[0].lv) : '', rows: rows.length,
    price: rows[0] ? rows[0].cost : 0, base: (window.ITEM_BASE || {}).fungicide || 0, loot });
})()`))
console.log('  来源: ' + JSON.stringify(src))
ok('⑦ 医疗台能做出抗真菌药', src.recipes >= 1 && /medlab/.test(src.recipeAt), JSON.stringify({ n: src.recipes, at: src.recipeAt }))
ok('⑦ 商人货架上有抗真菌药，且收购价 < 售价（M44 那条不变量）',
  src.rows >= 1 && src.price > 0 && src.base > 0 && src.base < src.price, JSON.stringify({ rows: src.rows, price: src.price, base: src.base }))
ok('⑦ 药房/医院/诊所的掉落表里都有它', src.loot.every(l => l.has), JSON.stringify(src.loot))

/* 回探索页收尾截图 */
await ev(`setTab('explore')`)
await sleep(600)
await shot('04_explore')

const pageErrs = errs.filter(e => !/favicon|hit\.off|Failed to load resource/i.test(e))
ok('⑧ 全程无 console 报错 / 未捕获异常', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n结果: ${pass}/${checks.length} 通过`)
await fs.writeFile(`${outDir}/m50_probe.json`, JSON.stringify({ checks, errs: pageErrs, body, cured, byBag, guide, src }, null, 2))
ws.close()
process.exit(pass === checks.length ? 0 : 1)
