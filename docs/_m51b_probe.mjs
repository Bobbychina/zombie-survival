/* M51b 探针：大区地图（12×12）的难度划分改成"和小区域地图一样的柏林噪声随机铺"之后，
   在**真构建产物**上把玩家看到的那张图读回来，当场验四条硬约束 + 三条形状指纹。

   为什么必须跑浏览器：难度场是纯逻辑、单测能钉；但"玩家看到的到底是哪张图"（图层是不是危险度、
   格子读的是不是 tier、颜色类 d1..d5 对不对）只有真 DOM 能证明。
   用法：node docs/_m51b_probe.mjs <cdpPort> <url> <outDir>
   （编号带 b：这个仓库同时可能有别的会话在跑自己的 M51，文件与里程碑编号都错开，免得互相覆盖） */
const [, , cdpPort, url, outDir] = process.argv;
const fs = await import('node:fs/promises');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 30 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { }
  if (!target) await sleep(500);
}
if (!target) { console.log('HAS FAIL: 连不上 CDP ' + cdpPort); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160));
};
const send = (method, params = {}, ms = 25000) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }); } }, ms); });
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 25000 });
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
};
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${n}.png`, Buffer.from(r.result.data, 'base64')); };

const out = []; let fails = 0;
const ok = (cond, label, extra = '') => { out.push((cond ? '  PASS  ' : '  FAIL  ') + label + (extra ? '  [' + extra + ']' : '')); if (!cond) fails++; };

await fs.mkdir(outDir, { recursive: true });
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 2048, height: 1200, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 'dev=ready' });
await sleep(4000);
out.push('标题: ' + await ev('document.title'));

/* 进「探索」页 → 开地图悬浮窗 → 切大区视图 → 切危险度图层 */
out.push('切探索页: ' + await ev(`(() => { const b=[...document.querySelectorAll('#tabs .tab')].find(e=>/探索/.test(e.textContent||'')); if(!b) return 'no-tab'; b.click(); return 'ok' })()`));
await sleep(900);
out.push('开地图: ' + await ev(`(() => { if (typeof V4Scale?.toggleMap === 'function' && !document.querySelector('#v4world')) V4Scale.toggleMap(); return 'ok' })()`));
await sleep(1200);
await ev(`V4World.mapMode('region')`); await sleep(1200);
await ev(`V4World.regionLayer('danger')`); await sleep(1200);
await shot('m51b_01_region_danger');

const grid = await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4world .rcell2')];
  if (cells.length !== 144) return { err: 'rcell2 数量 ' + cells.length };
  const g = [], nums = [];
  for (let r = 0; r < 12; r++) {
    const row = [], nrow = [];
    for (let c = 0; c < 12; c++) {
      const el = cells[r * 12 + c];
      const m = /(?:^|\\s)d([1-5])(?:\\s|$)/.exec(el.className || '');
      row.push(m ? Number(m[1]) : 0);
      const num = el.querySelector('.rnum');
      nrow.push(num ? (num.textContent || '').trim() : '');
    }
    g.push(row); nums.push(nrow);
  }
  const heads = [...document.querySelectorAll('#v4world .wmtab')].map(e => (e.textContent || '').trim() + (e.className.includes('on') ? '*' : ''));
  return { g, nums, heads, title: (document.querySelector('#v4world .sect-title') || {}).textContent };
})()`);
if (grid.err) { console.log('HAS FAIL: ' + grid.err); ws.close(); process.exit(1); }
const G = grid.g;
out.push('地图标题: ' + grid.title + ' | 图层按钮: ' + grid.heads.join(' '));
out.push('危险度数字（DOM 里格子上印的）:\n' + grid.nums.map(r => r.join(' ')).join('\n'));
out.push('危险度网格（从 .rcell2 的 dN 类读回来）:\n' + G.map(r => r.join('')).join('\n'));

ok(G.every(r => r.every(v => v >= 1 && v <= 5)), '144 格全部有合法危险度 1..5');
const hist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
for (const r of G) for (const v of r) hist[v]++;
ok([1, 2, 3, 4, 5].every(t => hist[t] > 0), '五个档位都用上', JSON.stringify(hist));
ok(String(grid.nums.flat().join('')) === String(G.flat().join('')), '格子上的数字与难度类一致（不是"颜色和数字各说各话"）');

/* 硬约束：从 DOM 反推主城（.rcell2.home），全部按玩家看到的这张图来判 */
const home = await ev(`(() => { const i=[...document.querySelectorAll('#v4world .rcell2')].findIndex(e=>e.className.includes('home')); return i<0?null:{c:i%12,r:Math.floor(i/12)} })()`);
ok(!!home, '地图上能找到主城格', home ? `(${home.c},${home.r})` : '');
if (home) {
  const dOf = (c, r) => Math.max(Math.abs(c - home.c), Math.abs(r - home.r));
  const maxDist = Math.max(...[0, 11].flatMap(c => [0, 11].map(r => dOf(c, r))));
  let jump = 0, safeBad = 0, outerBad = 0, outer2Bad = 0;
  const ringVals = new Map();
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
    const d = dOf(c, r);
    (ringVals.get(d) ?? ringVals.set(d, []).get(d)).push(G[r][c]);
    if (d <= 1 && G[r][c] !== 1) safeBad++;
    if (d >= maxDist && G[r][c] < 4) outerBad++;
    else if (d >= maxDist - 1 && G[r][c] < 3) outer2Bad++;
    for (const [dc, dr] of [[1, 0], [0, 1]]) if (c + dc < 12 && r + dr < 12) jump = Math.max(jump, Math.abs(G[r][c] - G[r + dr][c + dc]));
  }
  ok(safeBad === 0, '硬约束①：主城 + 紧邻一圈恒为安全区 1', '违规 ' + safeBad + ' 格');
  ok(jump <= 1, '硬约束②：相邻两格最多差 1', '最大差 ' + jump);
  ok(outerBad === 0, '硬约束③：最外圈 ≥4（地图边缘没有安全角落）', '违规 ' + outerBad + ' 格');
  ok(outer2Bad === 0, '外两圈 ≥3（四个角也算）', '违规 ' + outer2Bad + ' 格');
  const ringAvg = [];
  let mono = true, prev = 0;
  for (let d = 0; d <= maxDist; d++) {
    const v = ringVals.get(d) || [];
    ringAvg.push((v.reduce((a, b) => a + b, 0) / v.length).toFixed(2));
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    if (avg < prev - 0.35) mono = false;
    prev = avg;
  }
  ok(mono, '硬约束④：越往外整体越危险（环平均单调不减）', ringAvg.join(' '));

  /* 形状指纹：这张图是不是"同心方框" */
  let single = 0, rings = 0;
  for (let d = 2; d <= maxDist - 1; d++) {
    const v = ringVals.get(d) || [];
    if (v.length < 4) continue;
    rings++; if (new Set(v).size <= 1) single++;
  }
  const dup = (12 - new Set(G.map(r => r.join(''))).size) + (12 - new Set(G[0].map((_, c) => G.map(r => r[c]).join(''))).size);
  ok(single / rings <= 0.25, '形状：单值环（"这一圈全是同一个数"）≤25%', single + '/' + rings);
  ok(dup <= 3, '形状：没有整行/整列复制', '重复 ' + dup + ' 条');
}

/* 顺带看一眼本地地图的危险度层没被带坏（两张图共用同一份收尾实现）。
   本地地图的格子在危险度图层下带 `dg<1..5>` 类（见 world-ui.ts 的 cellHtml）；
   只有"点亮过"的格子才上色，所以这里只核对出现的那些，并报告亮了几个。 */
await ev(`V4World.mapMode('local')`); await sleep(1200);
await ev(`V4World.regionLayer('danger')`); await sleep(1000);
const localOk = await ev(`(() => {
  const cells = [...document.querySelectorAll('#v4world .wgrid .wcell.dlayer')];
  let colored = 0, bad = 0, min = 9, max = 0;
  for (const el of cells) {
    const cn = el.className || '';
    if (!/(^|\\s)dg/.test(cn)) continue;              // 没点亮过的格子不上色（迷雾）
    const m = /(^|\\s)dg([1-5])(\\s|$)/.exec(cn);
    if (!m) { bad++; continue; }                       // 有 dg 但档位不是 1..5 = 真坏了
    colored++;
    const v = Number(m[2]);
    min = Math.min(min, v); max = Math.max(max, v);
  }
  return { total: cells.length, colored, bad, min: colored ? min : null, max: colored ? max : null };
})()`);
out.push('本地地图（危险度层）: ' + JSON.stringify(localOk));
ok(localOk && localOk.colored >= 9 && localOk.bad === 0, '本地地图 24×24 上了色的格子档位都合法（没被共用实现带坏）');
await shot('m51b_02_local_danger');

ok(errs.length === 0, '整轮没有未捕获异常', errs.slice(0, 3).join(' | '));

console.log(out.join('\n'));
console.log(fails === 0 ? '\nALL PASS' : '\nHAS FAIL: ' + fails);
ws.close();
process.exit(fails === 0 ? 0 : 1);
