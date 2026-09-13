// M10 触屏适配验收：手机端（iPhone 390×844）+ 桌面端（1280×900）双视口截图 + DOM 断言
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_D = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 100))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 120))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

async function open(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile })
  await send('Emulation.setUserAgentOverride', { userAgent: mobile ? UA_M : UA_D })
  await send('Page.navigate', { url })
  await sleep(4000)
  /* 先记下"提醒出现过"，再点掉它——否则后面断言时它已经被自己关掉了 */
  const warnShown = await ev(`!!document.getElementById('mobile-warn')`)
  if (mobile) { await ev(`(() => { const b = document.querySelector('#mobile-warn button'); if (b) b.click(); })()`); await sleep(300) }
  return warnShown
}

const audit = `(() => {
  const vw = document.documentElement.clientWidth;
  const boxes = [];
  document.querySelectorAll('button, .btn, .tab, [onclick]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    boxes.push({ h: Math.round(r.height), tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + String(el.className||'').split(' ')[0]), t: (el.textContent||'').trim().slice(0,8) });
  });
  const small = boxes.filter(b => b.h < 40);
  const tab = document.querySelector('.tab');
  const cs = tab ? getComputedStyle(tab) : null;
  return JSON.stringify({
    vw, hScroll: document.documentElement.scrollWidth > vw + 1,
    smallCount: small.length, small: small.slice(0, 6),
    tabH: tab ? Math.round(tab.getBoundingClientRect().height) : 0,
    touchAction: cs ? cs.touchAction : '',
    minFont: Math.min(...[...document.querySelectorAll('#app span, #app div')].map(e => parseFloat(getComputedStyle(e).fontSize)).filter(n => n > 0)),
    mapCells: (() => { const c = document.querySelector('.wcell'); return c ? Math.round(c.getBoundingClientRect().height) : 0 })(),
    mobileWarn: !!document.getElementById('mobile-warn'),
    beta: !!document.getElementById('beta-notice'),
  });
})()`

// 手机
const warnShownM = await open(390, 844, true)
const m = JSON.parse(await ev(audit))
ok('[手机 390] 没有横向滚动', m.hScroll === false, 'vw=' + m.vw)
ok('[手机 390] 标签高度 ≥44', m.tabH >= 44, 'tab=' + m.tabH)
ok('[手机 390] 其余按钮基本 ≥40（地图格子除外）', m.smallCount <= 10 && m.small.every(b => /wcell|地图/.test(b.tag) || b.h >= 30), 'smallCount=' + m.smallCount + ' ' + JSON.stringify(m.small.slice(0, 4)))
ok('[手机 390] 触屏去掉 300ms 双击等待', m.touchAction === 'manipulation', 'touch-action=' + m.touchAction)
ok('[手机 390] 最小字号 ≥11px', m.minFont >= 11, 'min=' + m.minFont + 'px')
ok('[手机 390] 地图格子放大到 ≥30px', m.mapCells >= 30, 'cell=' + m.mapCells)
ok('[手机 390] 手机提醒出现过 + BETA 条在', warnShownM === true && m.beta === true, 'warnShown=' + warnShownM)
let s = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/m10-mobile-home.png', Buffer.from(s.result.data, 'base64'))
// 切到背包看看列表在手机上的样子
await ev(`(() => { const el = [...document.querySelectorAll('.tab')].find(e => /背包/.test(e.textContent)); if (el) el.click(); })()`)
await sleep(800)
s = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/m10-mobile-inv.png', Buffer.from(s.result.data, 'base64'))

// 桌面
const warnShownD = await open(1280, 900, false)
const d = JSON.parse(await ev(audit))
ok('[桌面 1280] 没有横向滚动', d.hScroll === false, 'vw=' + d.vw)
ok('[桌面 1280] 不弹手机提醒', warnShownD === false && d.mobileWarn === false, 'warnShown=' + warnShownD)
ok('[桌面 1280] 标签恢复紧凑（没有被手机规则撑高）', d.tabH < 44, 'tab=' + d.tabH)
ok('[桌面 1280] 地图格子仍是原尺寸', d.mapCells <= 30, 'cell=' + d.mapCells)
s = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/m10-desktop-home.png', Buffer.from(s.result.data, 'base64'))

console.log('\nconsole 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : '无'))
ok('无 console 错误', errs.length === 0)
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
