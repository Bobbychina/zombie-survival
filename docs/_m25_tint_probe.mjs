const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}; if (!target) await sleep(500) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms) })
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 40000 }); if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]; return r.result?.result?.value }
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${n}.png`, Buffer.from(r.result.data, 'base64')) }
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: url + '?dev=ready' }); await sleep(3200)
for (const [ap, name] of [[14, '20_phase_dawn'], [8, '21_phase_day'], [3, '22_phase_dusk'], [1, '23_phase_night']]) {
  const info = await ev(`(async () => {
    const S = DEV.state(); S.ap = ${ap}; S.debt = 0; S.skills.fitness = 0; S.apMax = 14
    renderTop(); setTab('explore')
    await new Promise(r => setTimeout(r, 1600))          // 等 1.4s 的颜色过渡跑完
    const t = document.getElementById('daytint')
    return phaseName()[0] + ' | ' + t.className.replace(' no-t','') + ' | ' + getComputedStyle(t).backgroundColor
  })()`)
  await shot(name)
  console.log(name + '  ' + info)
}
ws.close()
