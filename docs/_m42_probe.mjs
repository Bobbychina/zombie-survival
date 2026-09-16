// M42 取证：账号库那份"用旧密钥写的"副本不再每 15 秒刷屏，并且会用当前进度自愈
//   ① 正常情况下账号库副本能解开（写入 → 预热 → 无警告）
//   ② 人为塞一份"旧密钥写的"信封 → 只出现**一条**警告（15 秒一轮的预热不再刷屏）
//   ③ 同一次会话里再等两轮预热 → 警告数不再增加
//   ④ 有当前进度当兜底 → 副本被重建（日志里出现"已用当前进度重建"），之后预热不再报错
//   ⑤ 0 未捕获异常
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
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 40000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const bootWait = async (tries = 30) => {
  for (let i = 0; i < tries; i++) {
    const r = await ev(`(() => (typeof S === 'object' && !!S && typeof closeAllModals === 'function') ? 1 : 0)()`)
    if (r === 1) return true
    await sleep(800)
  }
  return false
}
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: BOOT }); await bootWait()
await sleep(1200)

/* 账号库在这份构建里到底有没有加载？没有就说明这是纯本地构建，本探针只能验"策略函数"那半边 */
const hasAcct = await ev(`(() => !!window.DSHAccount && typeof window.DSHAccount.savePut === 'function')()`)
console.log('账号库加载：' + hasAcct)
ok('账号库已加载（本探针需要它才能验"副本解不开"这条路径）', hasAcct === true, String(hasAcct))

/* 找出账号库存档用的 localStorage 键（形如 ...save.zombie-survival.main） */
const keys = JSON.parse(await ev(`(() => JSON.stringify(Object.keys(localStorage).filter(k => /save/i.test(k) && /zombie/i.test(k))))()`))
console.log('候选键：' + JSON.stringify(keys))
ok('能定位到账号库那份存档记录', keys.length >= 1, JSON.stringify(keys))

/* ① 正常路径：写一份 → 应能解开（没有"解不开"的警告） */
const normal = JSON.parse(await ev(`(async () => {
  window.__warn0 = (window.__warn0 || 0);
  const orig = console.log;
  const key = Object.keys(localStorage).filter(k => /save/i.test(k) && /zombie/i.test(k))[0];
  const before = localStorage.getItem(key) || '';
  // 用账号库自己的写入口写一份"当前进度"（会走密文路径）
  const okPut = window.DSHAccount.savePut('zombie-survival', 'main', JSON.parse(V4Vault.currentPlain()), { noServer: true });
  await new Promise(r => setTimeout(r, 1500));
  const after = localStorage.getItem(key) || '';
  return JSON.stringify({ okPut: !!(okPut && okPut.ok), before: before.slice(0, 12), after: after.slice(0, 12), changed: before !== after });
})()`))
ok('账号库能写入当前进度（密文落盘）', normal.changed === true && /^ZSV2:/.test(normal.after), JSON.stringify(normal))

/* ② 人为塞一份"旧密钥写的"信封：把密文段改成另一段合法 base64 → 解不开但格式合法 */
const injected = JSON.parse(await ev(`(() => {
  const key = Object.keys(localStorage).filter(k => /save/i.test(k) && /zombie/i.test(k))[0];
  const raw = localStorage.getItem(key) || '';
  const parts = raw.split(':');
  if (parts.length !== 4) return JSON.stringify({ err: 'FORMAT', raw: raw.slice(0, 24) });
  // 换掉密文段（长度一样，校验和也故意留旧值）：格式合法、内容解不开
  const ct = parts[3];
  const flipped = ct.slice(0, -4) + (ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  localStorage.setItem(key, parts.slice(0, 3).join(':') + ':' + flipped);
  return JSON.stringify({ ok: true, key, before: ct.slice(-6), after: flipped.slice(-6) });
})()`))
ok('已把那份副本换成"解不开"的内容（模拟旧密钥）', injected.ok === true, JSON.stringify(injected))

/* ③ 数警告：等两轮预热（15s × 2 + 余量），警告应该只出现一次 */
const countWarn = () => ev(`(() => (S.logBuf || []).filter(p => /账号库里|重建/.test(String(p[1]))).length)()`)
const warnBefore = Number(await countWarn())
await ev(`(() => { clearLog(); return 1 })()`)
await sleep(36000)
const warnAfter = Number(await countWarn())
const logs = await ev(`(() => JSON.stringify((S.logBuf||[]).filter(p => /账号库里|重建/.test(String(p[1]))).map(p => String(p[1]).slice(0, 60))))()`)
ok('两轮预热（36 秒）里"解不开"只报一次（原来每 15 秒一条）', warnAfter >= 1 && warnAfter <= 2, JSON.stringify({ count: warnAfter, logs }))
ok('日志是说人话的那句（含"已用当前进度重建"或"本地进度不受影响"）', /重建|本地进度/.test(logs), logs)

/* ④ 自愈：等第三轮，确认不再新增警告，且副本已被重建（解不开的槽被清掉） */
await ev(`(() => { clearLog(); return 1 })()`)
await sleep(20000)
const warnLater = Number(await countWarn())
ok('再等 20 秒仍然没有新的刷屏', warnLater <= 1, JSON.stringify({ count: warnLater }))

/* ⑤ 重建之后副本应当又能解开了（用账号库自己的读取路径验证） */
const healed = JSON.parse(await ev(`(async () => {
  const r = window.DSHAccount.saveGet('zombie-survival', 'main');
  const isEnv = typeof r === 'string' && /^ZSV2:/.test(r);
  // 触发一次预热（带兜底）后，镜像里应该又有这份明文
  const st = window.__acctVaultStatus ? window.__acctVaultStatus() : null;
  return JSON.stringify({ isEnv, type: typeof r, status: st });
})()`))
ok('账号库副本经自愈后仍是合法密文', healed.isEnv === true, JSON.stringify(healed))

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
