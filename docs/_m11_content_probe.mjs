// M11 内容验收（真浏览器）：新敌人能不能在实战里登场、机制有没有真的发生
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(4000)

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

// 1) 实战：把三种新敌人 + 首领塞进一场战斗（走玩家真实入口 window.startCombat）
const fight = await ev(`(async () => {
  window.startCombat(['spitter','bomber','hatcher'], { title:'M11 试炼', sub:'内容验收' });
  await new Promise(r => setTimeout(r, 1200));
  const t = document.body.innerText;
  return JSON.stringify({
    modal: !!document.querySelector('.overlay, .modal'),
    names: { spitter: t.includes('喷吐者'), bomber: t.includes('自爆者'), hatcher: t.includes('孵化者') },
    title: /M11 试炼/.test(t),
  });
})()`)
console.log('  实战: ' + fight)
const f = JSON.parse(fight)
ok('三种新敌人能在战斗里登场（界面出现名字）', f.names.spitter && f.names.bomber && f.names.hatcher, JSON.stringify(f.names))
ok('战斗弹窗正常打开、标题正确', f.modal === true && f.title === true, 'modal=' + f.modal + ' title=' + f.title)
const shot = await send('Page.captureScreenshot', { format: 'png' })
await fs.writeFile(outDir + '/m11-battle-newfoes.png', Buffer.from(shot.result.data, 'base64'))

// 3) 打几个回合，看机制日志真的出现（自爆/孵化/腐蚀/狂暴至少命中一条）
const logs = await ev(`(async () => {
  const out = [];
  for (let i = 0; i < 14; i++) {
    const btn = [...document.querySelectorAll('button')].find(b => /攻击|重击|速击|点射|连发|斩|劈/.test(b.textContent||''));
    if (!btn) break;
    btn.click();
    await new Promise(r => setTimeout(r, 260));
  }
  const txt = document.body.innerText;
  ['炸开','钻了出来','酸液','护甲','疯了'].forEach(k => { if (txt.includes(k)) out.push(k); });
  return JSON.stringify(out);
})()`)
console.log('  机制日志命中: ' + logs)
const hit = JSON.parse(logs)
ok('战斗中确实触发了新机制（至少一条机制文案出现）', hit.length > 0, logs)

// 4) POI 面板会显示"可能遇上"的新敌人（玩家在去之前就能看到）
const poiHint = await ev(`(() => {
  const t = document.body.innerText;
  return JSON.stringify({ shows: ['喷吐者','自爆者','孵化者','暴君'].filter(n => t.includes(n)) });
})()`)
console.log('  当前界面出现的新敌人名: ' + poiHint)

console.log('\nconsole 错误: ' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : '无'))
ok('无 console 错误', errs.length === 0)
console.log('结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
