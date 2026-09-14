// M25 逐页取证：探索 / 据点 / 制作 / 背包 / 技能 五页截图（用户视口 2048×1105）
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' })
await sleep(3500)
/* 造一个"能看"的存档：设施建起来、弹药备齐、辐射有点、技能有点 */
await ev(`(() => {
  const S = DEV.state()
  S.base.filter = 2; S.base.garden = 2; S.base.bench = 2; S.base.loading = 2; S.base.medlab = 1; S.base.kitchen = 1; S.base.power = 1; S.base.storage = 1
  S.inv.a9_fmj = 24; S.inv.a9_ap = 12; S.inv.a556_fmj = 60; S.inv.a556_ap = 20; S.inv.a12_buck = 8
  S.inv.iodine = 3; S.inv.radaway = 1; S.inv.geiger = 1
  S.eq.wpn = 'rifle'; S.rad = 32; S.skills.shoot = 3; S.skills.craft = 2
  render(); autosave()
})()`)
const pages = [['探索', '10_explore'], ['据点', '11_base'], ['制作', '12_craft'], ['背包', '13_inv'], ['技能', '14_skills']]
for (const [tabName, file] of pages) {
  await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/${tabName}/.test(e.textContent||'')); if(b) b.click(); return 1 })()`)
  await sleep(900)
  await shot(file)
  const info = await ev(`(() => {
    const v = document.getElementById('view'); const t = v.innerText || ''
    const de = document.scrollingElement
    const bad = (t.match(/undefined|NaN|\\[object/g) || [])
    let over = 0
    for (const el of v.querySelectorAll('*')) { if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 40) over++ }
    return JSON.stringify({ tab: S.tab, len: t.length, bad: bad.slice(0, 4), hOverflow: over, docScroll: de.scrollHeight > de.clientHeight + 1 })
  })()`)
  console.log(file + '  ' + info)
}
ws.close()
