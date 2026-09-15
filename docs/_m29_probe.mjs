// M29 取证：存档强制加密（worker 里的 AES-GCM-256 密钥）+ 去掉导出/导入 + 本机加密备份回滚
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
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
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }
await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1105, deviceScaleFactor: 1, mobile: false })
const pageUrl = url + (url.includes('?') ? '&' : '?') + 'dev=ready'

/* ── ① 保险箱起来了：worker 模式 + 密钥存在 ── */
await send('Page.navigate', { url: pageUrl }); await sleep(3800)
const boot = JSON.parse(await ev(`(() => {
  const v = window.V4Vault
  return JSON.stringify({ has: !!v, mode: v ? v.status().mode : 'none', ready: v ? v.status().ready : false })
})()`))
ok('保险箱已初始化', boot.has === true && boot.ready === true, JSON.stringify(boot))
ok('密钥在 worker 里（不是主线程降级）', boot.mode === 'worker', 'mode=' + boot.mode)

/* ── ② 写一次档：localStorage 里必须是密文，不能有明文 ── */
const write = JSON.parse(await ev(`(async () => {
  const S2 = DEV.state(); S2.day = 33; S2.mat = 777
  saveGame(true)
  await new Promise(r => setTimeout(r, 700))
  const raw = localStorage.getItem('zombie_survival_save_v2') || ''
  const bak = localStorage.getItem('zombie_survival_save_v2.bak') || ''
  let dec = ''
  try { dec = await window.V4Vault.decrypt(raw) } catch (e) { dec = 'ERR ' + e.message }
  return JSON.stringify({ head: raw.slice(0, 5), len: raw.length, 明文可见: /"day"/.test(raw) || /"mat"/.test(raw),
    day: (JSON.parse(dec) || {}).day, bakHead: bak.slice(0, 5), bakLen: bak.length,
    status: window.V4Vault.status() })
})()`))
ok('落盘的是密文（ZSV1: 前缀）', write.head === 'ZSV1:', JSON.stringify({ head: write.head, len: write.len }))
ok('存档文件里搜不到明文字段（day / mat）', write.明文可见 === false)
ok('密文能解回我存的那份（第 33 天）', write.day === 33, 'day=' + write.day)
ok('本机备份也是密文', write.bakHead === 'ZSV1:' || write.bakLen === 0, 'bak=' + write.bakHead + ' len=' + write.bakLen)
await shot('60_encrypted_save')

/* ── ③ 重新加载页面：应该自动解密读档（还是第 33 天） ── */
await ev(`(() => { const S2 = DEV.state(); S2.day = 33; saveGame(true); return 1 })()`); await sleep(600)
await send('Page.navigate', { url: pageUrl }); await sleep(3800)
const reload = JSON.parse(await ev(`JSON.stringify({ day: (window.S || {}).day, mat: (window.S || {}).mat, mode: window.V4Vault.status().mode })`))
ok('刷新后自动解密读档（回到第 33 天 / 777 材料）', reload.day === 33 && reload.mat === 777, JSON.stringify(reload))

/* ── ④ 老版本的明文存档 → 自动迁移成密文（老玩家不丢档） ── */
const migrate = JSON.parse(await ev(`(async () => {
  const plain = JSON.stringify(Object.assign({}, window.S, { day: 55, mat: 1234 }))
  localStorage.setItem('zombie_survival_save_v2', plain)          // 模拟 M28 之前的明文档
  return JSON.stringify({ wrote: plain.slice(0, 20) })
})()`))
await send('Page.navigate', { url: pageUrl }); await sleep(3800)
const afterMigrate = JSON.parse(await ev(`(() => {
  const raw = localStorage.getItem('zombie_survival_save_v2') || ''
  return JSON.stringify({ head: raw.slice(0, 5), day: (window.S || {}).day, 明文可见: /"day"/.test(raw) })
})()`))
ok('明文老档被自动迁移：读出来了（第 55 天）', afterMigrate.day === 55, 'day=' + afterMigrate.day)
ok('迁移后磁盘上只剩密文', afterMigrate.head === 'ZSV1:' && afterMigrate.明文可见 === false, JSON.stringify(afterMigrate))

/* ── ⑤ 密文被改坏 → 能发现，并回退到备份 ── */
const tamper = await ev(`(async () => {
  const raw = localStorage.getItem('zombie_survival_save_v2') || ''
  const i = Math.floor(raw.length / 2)
  localStorage.setItem('zombie_survival_save_v2', raw.slice(0, i) + (raw[i] === 'A' ? 'B' : 'A') + raw.slice(i + 1))
  try { await window.V4Vault.decrypt(localStorage.getItem('zombie_survival_save_v2')); return 'NO-THROW' } catch (e) { return 'THREW: ' + e.message }
})()`)
ok('密文被改一个字符 → 解密报错（不是静默读出错数据）', /THREW/.test(String(tamper)), String(tamper).slice(0, 60))

/* ── ⑥ 菜单里没有导出/导入了；有加密备份回滚 ── */
const menu = JSON.parse(await ev(`(() => {
  openMenu()
  const ov = [...document.querySelectorAll('.modal')].find(m => /☰ 菜单/.test(m.innerText || ''))
  const txt = ov ? ov.innerText : ''
  const btns = ov ? [...ov.querySelectorAll('button')].map(b => b.textContent.trim()) : []
  /* 判定看**按钮**不看正文：正文里明确写了"不再提供导出明文存档"，那是说明不是入口 */
  const has导出按钮 = btns.some(b => /导出/.test(b))
  const has导入按钮 = btns.some(b => /导入/.test(b))
  closeAllModals()
  return JSON.stringify({ has导出按钮, has导入按钮, 提到不再提供: /不再提供/.test(txt), has回滚: btns.some(b => /回滚/.test(b)), btns })
})()`))
ok('菜单里没有「导出存档」按钮了', menu.has导出按钮 === false, JSON.stringify(menu.btns))
ok('菜单里没有「导入存档」按钮了', menu.has导入按钮 === false)
ok('菜单正文说明了"不再提供导出明文存档"', menu.提到不再提供 === true)
ok('菜单里有「🛟 回滚备份」（本机加密备份）', menu.has回滚 === true)
await ev(`openMenu()`); await sleep(500); await shot('61_menu_no_export'); await ev(`closeAllModals()`)

/* ── ⑦ 回滚备份能用（把当前进度换成备份里的那份） ── */
const rollback = JSON.parse(await ev(`(async () => {
  const S2 = DEV.state(); S2.day = 90; saveGame(true)      // 先写一份"第 90 天"（这会把上一份挪进备份）
  await new Promise(r => setTimeout(r, 700))
  const S3 = DEV.state(); S3.day = 5; saveGame(true)       // 再写"第 5 天" → 备份里是第 90 天
  await new Promise(r => setTimeout(r, 700))
  const bak = await window.V4Vault.loadBackup()
  return JSON.stringify({ 备份里的天: JSON.parse(bak).day, 当前: DEV.state().day })
})()`))
ok('备份里存着上一份存档（第 90 天）', rollback.备份里的天 === 90, JSON.stringify(rollback))
await ev(`restoreBackup()`); await sleep(600)
await ev(`document.getElementById('bak-go').click()`); await sleep(900)
const rolled = JSON.parse(await ev(`JSON.stringify({ day: (window.S || {}).day })`))
ok('点「回滚并覆盖」之后回到备份那一天（第 90 天）', rolled.day === 90, JSON.stringify(rolled))
await shot('62_rollback')

/* ── ⑧ 密钥不可导出（真正的"密钥不出 worker"） ── */
const keyCheck = await ev(`(async () => {
  try {
    const db = await new Promise((res, rej) => { const rq = indexedDB.open('zsv-vault', 2); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error) })
    const k = await new Promise((res, rej) => { const r = db.transaction('keys','readonly').objectStore('keys').get('save-key-v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    if (!k) return 'no-key'
    const info = { type: k.type, algo: k.algorithm && k.algorithm.name, len: k.algorithm && k.algorithm.length, extractable: k.extractable, usages: k.usages }
    try { await crypto.subtle.exportKey('raw', k); return JSON.stringify(Object.assign(info, { exported: 'YES(不安全)' })) }
    catch (e) { return JSON.stringify(Object.assign(info, { exported: 'NO: ' + e.name })) }
  } catch (e) { return 'ERR ' + e.message }
})()`)
ok('密钥是 AES-GCM-256', /"algo":"AES-GCM"/.test(String(keyCheck)) && /"len":256/.test(String(keyCheck)), String(keyCheck).slice(0, 120))
/* M29 补充：v2 库里存的那把必须是 extractable:false（账号库那条同步链路拿的是内存里的临时密钥） */
ok('IndexedDB 里那把密钥不可导出（exportKey 被拒）', /"exported":"NO/.test(String(keyCheck)), String(keyCheck).slice(-40))

/* ── ⑨ M29 补充：账号库那条链路（本机记录 / GitHub Gist / OneDrive）也走密文 ── */
const av = JSON.parse(await ev(`(async () => {
  const raw = await window.V4Vault.getKeyRaw({ tag: 'account-save-v1' })
  return JSON.stringify({ keyReady: !!raw, keyLen: raw ? raw.length : 0, status: window.V4AccountVault.status() })
})()`))
ok('账号库链路拿到 worker 的密钥（128 位以上）', av.keyReady === true && av.keyLen >= 20, JSON.stringify(av))

/* 用真账号库做"假登录"：只测记录读写那一层，不联网 */
const acct = JSON.parse(await ev(`(async () => {
  const a = window.DSHAccount
  const snapshot = { uid: a.currentUid(), cur: a.current() }
  a.currentUid = () => 'probe-uid'                       // 骗出一个独立账号空间
  a.current = () => ({ uid: 'probe-uid', name: 'probe', email: '', createdAt: '', providers: {}, saveGames: [] })
  const data = { day: 42, mat: 1234, inv: { ammo: 9 }, who: '幸存者' }
  const put = a.savePut('zombie-survival', 'main', data, { noServer: true })
  await new Promise(r => setTimeout(r, 1200))            // 等异步加密落盘
  const disk = a.saveGet('zombie-survival', 'main')
  const recKey = 'dsh.save.v1.probe-uid.zombie-survival.main'
  const stored = localStorage.getItem(recKey) || ''
  let parsed = null; try { parsed = JSON.parse(stored) } catch {}
  const diskLen = String((parsed || {}).data || '').length          // 真正落盘的是记录里那个 data 字段
  const back = a.saveGet('zombie-survival', 'main')
  a.saveDelete('zombie-survival', 'main', true)          // 清掉 probe 的记录
  a.currentUid = () => snapshot.uid; a.current = () => snapshot.cur
  return JSON.stringify({
    putOk: put.ok, isEnvelope: typeof disk === 'string' && disk.startsWith('ZSV2:'),
    明文可见: /"day"|"mat"|1234/.test(String(disk)),
    fileHasPlain: /1234|幸存者/.test(stored),
    recKey, dataHead: String(parsed && parsed.data).slice(0, 5), diskLen,
    got: JSON.stringify(back || null),
  })
})()`))
ok('savePut 后磁盘上是 ZSV2: 密文（不是明文对象）',
  acct.dataHead === 'ZSV2:' && acct.diskLen > 40,
  JSON.stringify({ head: acct.dataHead, cipherLen: acct.diskLen }))
ok('密文里搜不到明文字段（day / mat / 1234 / 幸存者）', acct.明文可见 === false && acct.fileHasPlain === false, acct.recKey)
ok('saveGet 同步给回明文对象（写入后同一会话内）', /"day":42/.test(String(acct.got)), String(acct.got).slice(0, 60))

ok('控制台无异常', errs.length === 0, errs.slice(0, 2).join(' | '))

const pass = checks.filter(c => c[1]).length
console.log(`\n${pass}/${checks.length} ${pass === checks.length ? 'ALL PASS' : 'HAS FAILURES'}`)
ws.close()
