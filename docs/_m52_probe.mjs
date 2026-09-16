/* M52 探针：体温对外必须是摄氏度（用户：「体温改成摄氏度（50-100 的体温好诡异）」）。
   内部仍是 0~100 的"体温点"（50 = 舒适），换算只在 env-core.tempC/tempText 一处 ——
   所以这组断言既要看页面上的字（℃ 读数、档位词），也要看"原始刻度不许漏到界面上"。
   ① 环境行 / 顶栏 chip / 人体页「体温与环境」都显示 xx.x℃，且正常值是 37.0℃
   ② 页面上找不到"体温 50"这类原始刻度（正则扫全页文本）
   ③ 掉到阈值以下时：档位词变"偏低"、惩罚提示里带 35.8℃、chip 变冷色
   ④ 温度高时：档位词变"偏高"（38.8℃ 以上）
   ⑤ 下水日志按摄氏说变化量（一格 -0.4℃）
   ⑥ 控制台无异常 + 截图（探索页环境卡 / 人体页体温与环境）
   用法：node docs/_m52_probe.mjs <cdpPort> <url> <outDir> */
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 150))
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
await sleep(500)

/* ① 正常体温：探索页环境行 + 人体页；chip 那一段（M50 起 HUD 不再挂）只验函数输出 */
const normal = JSON.parse(await ev(`(() => {
  closeAllModals();
  S.env = S.env || {}; S.env.temp = 50;      // 内部舒适点 = 37.0℃
  S.tab = 'explore'; render();
  const line = (() => { try { return V4.env.envLine(); } catch (e) { return 'EXC ' + e.message } })();
  const chips = (() => { try { return V4.env.envChips(); } catch (e) { return 'EXC ' + e.message } })();
  const page = document.body.textContent || '';
  return JSON.stringify({ line, chips, raw50: /体温 ?50(?!\\d|\\.\\d*℃)/.test(page), tempText: V4.env.tempText(50) });
})()`))
ok('环境行用摄氏度（体温 37.0℃（正常））', /体温 37\.0℃（正常）/.test(normal.line || ''), JSON.stringify(normal.line).slice(0, 120))
ok('体温 chip 的 HTML 是 37.0℃（M50 起它不在 HUD 上，只验函数输出）', /🌡️ <b>37\.0℃<\/b>/.test(normal.chips || ''), JSON.stringify(String(normal.chips)).slice(0, 140))
ok('chip 悬停提示给的是摄氏阈值（35.8℃ / 38.8℃）', /35\.8℃/.test(normal.chips || '') && /38\.8℃/.test(normal.chips || ''), JSON.stringify(String(normal.chips)).slice(0, 200))
ok('全页文本里没有"体温 50"这种原始刻度', normal.raw50 === false, String(normal.raw50))

const body = JSON.parse(await ev(`(() => {
  S.tab = 'body'; render();
  const txt = (document.getElementById('view') || {}).textContent || '';
  const m = txt.match(/🌡️ 体温([^·]*)·([^\\n]{0,14})/);
  return JSON.stringify({ hasEnv: /体温与环境/.test(txt), tempRow: m ? (m[1].trim() + ' · ' + m[2].trim()) : null,
    celsius: /体温\\s*37\\.0℃/.test(txt), raw: /体温\\s*50(?!\\d|\\.\\d*℃)/.test(txt), len: txt.length });
})()`))
ok('人体页「体温与环境」有摄氏读数（37.0℃ · 正常）', body.hasEnv && body.celsius, JSON.stringify(body))
ok('人体页也没有原始刻度', body.raw === false, String(body.raw))
await ev(`(() => { S.tab = 'explore'; render(); return 1 })()`); await sleep(600)
await shot('m52_01_normal')

/* ② 低温：档位词、惩罚提示、chip 配色 */
const cold = JSON.parse(await ev(`(() => {
  closeAllModals(); S.env.temp = 22;      // 内部 22 点 = 35.3℃，低于 35.8℃
  S.tab = 'body'; render();
  const view = (document.getElementById('view') || {}).textContent || '';
  const m = view.match(/🌡️ 体温([^·]*)·([^💧]{0,16})/);
  const pen = V4.env.tempPenalty(S.env.temp);
  const chips = V4.env.envChips();
  const chipCls = (chips.match(/class="chip ([^"]*)"/) || [])[1] || '';
  return JSON.stringify({ view: m ? m[0].trim() : view.slice(0, 200), note: pen.note, ap: pen.ap,
    chips, chipCls, txt: V4.env.tempText(22), state: V4.env.tempStateText(22, true) });
})()`))
ok('低温：人体页写「35.3℃ · 偏低：行动力与命中被压」', /35\.3℃/.test(cold.view || '') && /偏低/.test(cold.view || ''), JSON.stringify(cold.view))
ok('低温：惩罚提示里带摄氏阈值 35.8℃', /35\.8℃/.test(cold.note || '') && cold.ap === -1, JSON.stringify(cold.note).slice(0, 120))
ok('低温：体温 chip 变冷色且显示 35.3℃', /cold/.test(cold.chipCls || '') && /35\.3℃/.test(cold.chips || ''), JSON.stringify({ cls: cold.chipCls, chip: String(cold.chips).slice(0, 90) }))
await shot('m52_02_cold')

/* ③ 高温：档位词与水分提示 */
const hot = JSON.parse(await ev(`(() => {
  closeAllModals(); S.env.temp = 95;      // 内部 95 点 = 39.7℃，高于 38.8℃
  S.tab = 'body'; render();
  const view = (document.getElementById('view') || {}).textContent || '';
  const m = view.match(/🌡️ 体温[^💧]{0,40}/);
  const pen = V4.env.tempPenalty(S.env.temp);
  return JSON.stringify({ view: m ? m[0].trim() : view.slice(0, 200), note: pen.note, txt: V4.env.tempText(95) });
})()`))
ok('高温：人体页写 39.7℃ · 偏高（水分流失更快）', /39\.7℃/.test(hot.view || '') && /偏高/.test(hot.view || ''), JSON.stringify(hot.view))
ok('高温：惩罚提示里带 38.8℃', /38\.8℃/.test(hot.note || ''), JSON.stringify(hot.note).slice(0, 120))

/* ④ "体温变化量"也按摄氏说（列表里那几种来源：下水/淋湿/过夜） */
const deltas = JSON.parse(await ev(`(() => JSON.stringify({
  swim: V4.env.tempDeltaText(-6),      // 下一个水块：内部 -6 点
  snow: V4.env.tempDeltaText(-6),      // 雪天一次暴露
  warm: V4.env.tempDeltaText(6),       // 火堆/室内回温
}))()`))
ok('体温变化量按摄氏说（-6 点 = -0.4℃ / +6 点 = +0.4℃）',
  deltas.swim === '-0.4℃' && deltas.warm === '+0.4℃', JSON.stringify(deltas))

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))
const pass = checks.filter((c) => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
