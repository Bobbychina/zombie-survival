// 手机端精测：哪些元素点不了 / 哪些字太小 / 地图容器能不能划
const [, , cdpPort, url] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setUserAgentOverride', { userAgent: UA })
await send('Page.navigate', { url })
await sleep(4000)
await ev(`(() => { const b = document.querySelector('#mobile-warn button'); if (b) b.click(); })()`)
await sleep(300)

const sel = (el) => {
  if (el.id) return '#' + el.id
  const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
}
console.log(await ev(`(() => {
  const out = [];
  const seen = {};
  document.querySelectorAll('button, .btn, .tab, [onclick]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.height >= 44 && r.width >= 44) return;
    const k = (${sel.toString()})(el);
    seen[k] = seen[k] || { sel: k, w: Math.round(r.width), h: Math.round(r.height), n: 0, text: (el.textContent||'').trim().slice(0,10) };
    seen[k].n++;
  });
  out.push('--- 小于 44px 的点按目标 ---');
  Object.values(seen).forEach(v => out.push('  ' + v.sel.padEnd(24) + ' ' + v.w + '×' + v.h + '  ×' + v.n + '  ' + v.text));

  const wrap = document.querySelector('.wmapwrap');
  out.push('--- 地图容器 ---');
  if (wrap) {
    const cs = getComputedStyle(wrap);
    const r = wrap.getBoundingClientRect();
    out.push('  .wmapwrap 可视宽 ' + Math.round(r.width) + ' 内容宽 ' + wrap.scrollWidth + ' overflowX=' + cs.overflowX + ' touch=' + cs.webkitOverflowScrolling);
  } else out.push('  没有 .wmapwrap');

  out.push('--- 字号最小的一批 ---');
  const small = [];
  document.querySelectorAll('.hint, .muted, .log, #log, .chip, .meta, p, span').forEach(el => {
    const fs = parseFloat(getComputedStyle(el).fontSize);
    const t = (el.textContent || '').trim();
    if (fs > 0 && fs < 12.5 && t.length > 3) small.push({ fs, sel: (${sel.toString()})(el), t: t.slice(0, 14) });
  });
  small.sort((a,b) => a.fs - b.fs);
  small.slice(0, 8).forEach(x => out.push('  ' + x.fs + 'px  ' + x.sel.padEnd(20) + ' ' + x.t));

  out.push('--- 触摸相关 ---');
  const b = document.querySelector('.tab') || document.querySelector('button');
  if (b) { const cs = getComputedStyle(b); out.push('  按钮 touch-action=' + cs.touchAction + ' tap-highlight=' + cs.webkitTapHighlightColor); }
  out.push('  body text-size-adjust=' + getComputedStyle(document.body).webkitTextSizeAdjust);
  out.push('  viewport meta=' + (document.querySelector('meta[name=viewport]') || {}).content);
  return out.join('\\n');
})()`))
ws.close()
