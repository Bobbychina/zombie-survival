const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push((m.params.args||[]).map(a=>String(a.value??'')).join(' ').slice(0,160))
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails?.exception?.description||'').split('\n')[0].slice(0,160)) }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 40000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3200)
console.log('新档: ' + await ev(`(() => { const S = DEV.state(); return JSON.stringify({ ap: S.ap, apMax: S.apMax, phase: phaseName()[0], fitness: S.skills.fitness, cap: V4Night.apCapOf(0, S.skills.fitness) }) })()`))
console.log('体能 9 级: ' + await ev(`(() => { const S = DEV.state(); S.skills.fitness = 9; V4Night.syncApMax(); return JSON.stringify({ apMax: S.apMax, bonus: V4Night.fitnessApBonus(9) }) })()`))
console.log('野睡一夜后: ' + await ev(`(async () => { const S = DEV.state(); S.skills.fitness = 0; V4Night.syncApMax(); const s = V4World ? null : null; return 'skip' })()`))
console.log('睡满恢复: ' + await ev(`(() => { const S = DEV.state(); S.skills.fitness = 6; S.ap = 3; V4Night.syncApMax(); const before = S.apMax; sleepNight(); return JSON.stringify({ before, day: S.day, ap: S.ap, apMax: S.apMax, debt: JSON.parse(localStorage.getItem('zsv_worlds_v1')||'{}') && null }) })()`))
console.log('HUD: ' + await ev(`(() => { const p = document.getElementById('ap-pips'); return p ? p.innerText.replace(/\\n/g,' ') + ' | pips=' + p.querySelectorAll('.ap').length + ' | w=' + Math.round(p.getBoundingClientRect().width) : 'none' })()`))
await ev(`setTab('explore')`); await sleep(800)
console.log('探索页文案: ' + await ev(`(() => { const t = document.getElementById('view').innerText; const m = t.match(/行动力[^\\n]{0,60}/g); return JSON.stringify(m ? m.slice(0,3) : []) })()`))
await ev(`setTab('base')`); await sleep(700)
console.log('纸条(今夜卡): ' + await ev(`(() => { const t = document.getElementById('view').innerText; const m = t.match(/明早[^\\n]{0,50}|AP 上限[^\\n]{0,20}/g); return JSON.stringify(m ? m.slice(0,4) : []) })()`))
console.log('errors: ' + (logs.length ? logs.slice(0,3).join(' | ') : 'none'))
ws.close()
