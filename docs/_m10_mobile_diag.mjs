// 手机端体验诊断：布局溢出 / 点按目标尺寸 / 关键操作能不能点 / console 错误
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 120))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 140))
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setUserAgentOverride', { userAgent: UA })
await send('Page.navigate', { url })
await sleep(4000)

// 关掉"手机端暂未适配"提醒，别挡着诊断
await ev(`(() => { const b = document.querySelector('#mobile-warn button'); if (b) b.click(); })()`)
await sleep(300)

const report = await ev(`(() => {
  const vw = document.documentElement.clientWidth;
  const overflow = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1 && r.height > 0 && getComputedStyle(el).position !== 'fixed') {
      overflow.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 30), id: el.id || '', w: Math.round(r.width) });
    }
  });
  const small = [];
  document.querySelectorAll('button, a.btn, .btn, [onclick]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40)) {
      small.push({ t: (el.textContent || '').trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) });
    }
  });
  return JSON.stringify({
    vw, docW: document.documentElement.scrollWidth,
    hScroll: document.documentElement.scrollWidth > vw + 1,
    overflowTop: overflow.slice(0, 8),
    overflowCount: overflow.length,
    smallTargets: small.length,
    smallSample: small.slice(0, 10),
    buttons: document.querySelectorAll('button, .btn').length,
    hasDpad: !!document.querySelector('[class*=pad], [id*=pad], [class*=touch]'),
  }, null, 1);
})()`)
console.log('=== 布局诊断（375×812）===')
console.log(report)

const shot1 = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/mobile-game-1-home.png', Buffer.from(shot1.result.data, 'base64'))

// 点几个关键入口，看手机上能不能真的操作
const clicks = [['探索', 'explore'], ['背包', 'inv'], ['据点', 'base']]
for (const [label] of clicks) {
  const r = await ev(`(() => {
    const els = [...document.querySelectorAll('button, .btn, .tab, [onclick]')];
    const el = els.find(e => (e.textContent || '').trim().indexOf(${JSON.stringify(label)}) >= 0);
    if (!el) return 'not-found';
    el.click();
    return 'clicked:' + (el.textContent || '').trim().slice(0, 10);
  })()`)
  await sleep(700)
  const panel = await ev(`(() => {
    const o = document.querySelector('.overlay, .modal, .panel');
    return o ? (o.className + ' :: ' + (o.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)) : '(没有弹层)';
  })()`)
  console.log('点击「' + label + '」→ ' + r + ' | ' + panel)
}
const shot2 = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/mobile-game-2-panel.png', Buffer.from(shot2.result.data, 'base64'))

console.log('\nconsole 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 5)) : '无'))
ws.close()
