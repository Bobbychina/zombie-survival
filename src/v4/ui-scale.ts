/* M32 · 界面适配的**运行时**：字号档位 + 地图悬浮窗。偏好落在 localStorage（ui-scale-core 那套纯逻辑）。
 *
 * 为什么字号用 `zoom` 而不是把几百条 `font-size` 全改成 `rem`：
 *   legacy 的样式表里全是 px 字号（几百处），一个个换既容易漏、又会和 `fitMap` 这类"按像素算尺寸"的
 *   代码打架。`zoom` 是**整块等比放大**（字号、间距、按钮命中区一起长），Chromium 原生支持，
 *   而且它只在卡片区生效 —— 视口、vw/vh、fixed 定位都不受影响，布局账不会崩。
 *   代价：`zoom` 之后 getBoundingClientRect 返回的是**缩放后**的值，所以 fitMap 里的换算要除一次 zoom。
 */
import { L } from '../main';
import {
  DEFAULT_PREFS, FS_KEY, clampFs, fsLabel, mapStyleLabel, mapStyleNote, normalizeMapStyle, readPrefs,
  scaleStatus, stepFs, writePrefs, type MapStyle, type UiPrefs,
} from './ui-scale-core';

let prefs: UiPrefs = { ...DEFAULT_PREFS };
let loaded = false;

const store = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })();

function ensure(): UiPrefs {
  if (!loaded) { prefs = readPrefs(store); loaded = true; }
  return prefs;
}

export const uiPrefs = (): UiPrefs => ({ ...ensure() });
export const fsNow = (): number => ensure().fs;
export const zoomNow = (): number => clampFs(ensure().fs) / 100;
export const mapOpenNow = (): boolean => ensure().mapOpen;
/** M34：地图摆法（float=悬浮窗 / inline=嵌入页内） */
export const mapStyleNow = (): MapStyle => normalizeMapStyle(ensure().mapStyle);
export const mapStyleNoteNow = (): string => mapStyleNote(ensure().mapStyle);

/** 把字号落到 DOM：CSS 变量 `--fs`（字号）+ 卡片区与地图窗的 zoom。
    **每次 mountWorldPanel 之后都要调一次** —— #v4cards 是那之后才被创建出来的。
    M34：顺带把地图摆法写到 <html data-mapstyle>（CSS 靠它决定悬浮窗/嵌入页的规则）。 */
export function applyScale(): void {
  const p = ensure();
  const z = p.fs / 100;
  try {
    const root = document.documentElement;
    root.style.setProperty('--fs', String(z));
    root.dataset.fs = String(p.fs);
    root.dataset.mapstyle = normalizeMapStyle(p.mapStyle);
    applyCardsZoom();
  } catch (e) { console.warn('[v4] 字号应用失败', e); }
}
/** 只给卡片区上 zoom（地图窗在 CSS 里已经 `zoom:var(--fs)` 了）。
    M32.1：**地图卡不能再自己 zoom** —— `#v4world` 住在 `#v4mapwin` 里，两处都设 zoom 会**相乘**
    （160% → 2.56×）：实测地图网格比窗口宽 110px（右列被切）、地图卡高 2091px（窗口才 1035），
    fitMap 那套"按容器像素算格子"的账全部失真。一层 zoom 就够，窗口自己那份已经把标题/图例一起放大。 */
export function applyCardsZoom(): void {
  const z = zoomNow();
  try {
    const board = document.getElementById('v4cards') as HTMLElement | null;
    if (board) board.style.zoom = z === 1 ? '' : String(z);
  } catch { /* 忽略 */ }
}

/** 设置字号（☰ 菜单/探针调用）：直接给档位 */
export function setFs(fs: number): number {
  const p = ensure();
  p.fs = clampFs(fs);
  writePrefs(store, p);
  applyScale();
  try { L.render(); } catch { /* 还没 boot 完 */ }
  L.toast('字号：' + fsLabel(p.fs) + '（' + p.fs + '%）', '整块界面等比放大；' + mapStyleNote(p.mapStyle), 'info');
  return p.fs;
}
export function stepFsBtn(dir: number): number {
  const p = ensure();
  p.fs = stepFs(p.fs, dir);
  writePrefs(store, p);
  applyScale();
  try { L.render(); } catch { /* 还没 boot 完 */ }
  L.toast('字号：' + fsLabel(p.fs) + '（' + p.fs + '%）', '整块界面等比放大；' + mapStyleNote(p.mapStyle), 'info');
  return p.fs;
}
export const fsName = (): string => fsLabel(ensure().fs);

/** M34.1：切换地图摆法（悬浮窗 ⇄ 嵌入页内）。落偏好 + 写 data-mapstyle，再让世界面板重挂一次 ——
    地图卡是"从窗 body 搬进 #view（或反向）"，只有 mountWorldPanel 知道该怎么摆，所以必须重挂。
    两处用户报障的修正：
      ① "要再点一下才切"：嵌入的地图只在探索页出现，人在背包/制作页切过去等于什么都没发生 ——
         切 inline 时顺手把页签带回探索页（玩家眼睛立刻能看见结果）；
      ② 菜单里的按钮点了菜单还开着，默认的悬浮窗就在菜单**背后**变，玩家自然以为"没起作用" ——
         按钮的 onclick 里跟着 closeAllModals()（见 scaleButtonsHtml）。 */
export function setMapStyle(v: MapStyle): MapStyle {
  const p = ensure();
  p.mapStyle = normalizeMapStyle(v);
  writePrefs(store, p);
  applyScale();
  if (p.mapStyle === 'inline') {
    /* 探索页之外没有"嵌入"可言：先回去，再重挂（setTab 自己会 render 一次） */
    try { (window as any).setTab?.('explore'); } catch { /* 还没 boot 完 */ }
  }
  try { L.render(); } catch { /* 还没 boot 完 */ }
  try { (window as any).V4World?.remount?.(); } catch { /* 世界面板还没起来 */ }
  try { paintMapOverlay(); } catch { /* 忽略 */ }
  L.toast('地图位置：' + mapStyleLabel(p.mapStyle), mapStyleNote(p.mapStyle), 'info');
  return p.mapStyle;
}

/** 地图悬浮窗开关（任何页签都能开）。M34：inline 模式下同一个开关管"嵌入的地图折叠了没" */
export function toggleMap(force?: boolean): boolean {
  const p = ensure();
  p.mapOpen = typeof force === 'boolean' ? force : !p.mapOpen;
  writePrefs(store, p);
  try { paintMapOverlay(); } catch (e) { console.warn('[v4] 地图悬浮窗切换失败', e); }
  return p.mapOpen;
}

/** M34.1：悬浮窗/折叠条的上沿 —— **按实测**算，AC 里不许写死常量。
    站点的 BETA 公告条（#beta-notice，sticky，实测 33px）在正常流里占高，把顶栏整体往下推；
    而 CSS 原来写的是 `top:calc(var(--beta-h,0px) + 52px)`，站点脚本并不设 --beta-h ⇒ 取 0 ⇒ 窗顶落在 52px，
    正好**压住右上角那排按钮**（🗺️ / 🔊 / ? / ☰）—— 用户报障"地图的按钮挡住了设置"，其实点下去命中的是窗头。
    这里量一次 #topbar 的底边写进 --v4-maptop（顶栏换了行/多了提示条也能自适应）。 */
export function paintMapTop(): void {
  try {
    const top = document.getElementById('topbar');
    const r = top ? top.getBoundingClientRect() : null;
    if (!r || r.height <= 0) return;
    document.documentElement.style.setProperty('--v4-maptop', Math.round(r.bottom + 6) + 'px');
  } catch { /* 量不到就让 CSS 的兜底值上 */ }
}

/** 悬浮窗的显隐 + 头部文案（地图内容本身由 world-ui 的 mountWorldPanel 填）。
    M34：inline 模式下悬浮窗整体由 CSS 藏起来，这里的 `.closed` 只用来点亮右上角那个小条；
    面板本身的开/合落到 #view 的 `.mapfold` 上（CSS 再把嵌入的地图卡收起来）。 */
export function paintMapOverlay(): void {
  const p = ensure();
  paintMapTop();                       // 先摆好上沿，再看开合（顶栏高度会随 BETA 条/换行变）
  const win = document.getElementById('v4mapwin');
  if (!win) return;
  win.classList.toggle('open', p.mapOpen);
  win.classList.toggle('closed', !p.mapOpen);
  const btn = document.getElementById('btn-v4map');
  if (btn) { btn.classList.toggle('on', p.mapOpen); btn.setAttribute('aria-expanded', String(p.mapOpen)); }
  const body = win.querySelector('.mwbody') as HTMLElement | null;
  if (body) body.style.display = p.mapOpen ? '' : 'none';
  const view = document.getElementById('view');
  if (view) view.classList.toggle('mapfold', normalizeMapStyle(p.mapStyle) === 'inline' && !p.mapOpen);
}

/** 探针/调试：一次性把状态交出去 */
export const scaleStatusNow = () => ({
  ...scaleStatus(ensure()), zoomNow: zoomNow(), canOpenMap: !!document.getElementById('v4mapwin'),
  mapWhere: (document.getElementById('v4world')?.parentElement?.id || 'none'),
});

/** 折叠/展开后要重算地图格子（悬浮窗尺寸变了） */
export function paintMap(): void { paintMapOverlay(); }
export function scaleButtonsHtml(): string {
  const p = ensure();
  const z = p.fs / 100;
  const style = normalizeMapStyle(p.mapStyle);
  /* M34：地图摆法两个按钮 —— 选中态用 .ok，跟字号那几个按钮一样。
     M34.1：点完顺手关掉菜单 —— 不然切换发生在菜单背后，玩家看着"没反应"又点一次（用户报障）。 */
  const styleBtn = (v: MapStyle, icon: string): string =>
    '<button class="btn sm' + (style === v ? ' ok' : '') + '" ' +
    'onclick="V4Scale.setMapStyle(\'' + v + '\');typeof closeAllModals===\'function\'&&closeAllModals()" ' +
    'title="' + mapStyleNote(v) + '">' + icon + ' ' + mapStyleLabel(v) + '</button>';
  return '<div class="row" style="gap:4px;align-items:center">' +
    '<button class="btn sm" onclick="V4Scale.step(-1)" title="字号调小一档">A−</button>' +
    '<span class="chip" style="min-width:74px;text-align:center">🔠 <b>' + fsLabel(p.fs) + '</b> ' + p.fs + '%</span>' +
    '<button class="btn sm" onclick="V4Scale.step(1)" title="字号调大一档">A+</button>' +
    '</div>' +
    '<div class="row" style="gap:4px;align-items:center;margin-top:6px">' +
    '<span class="hint" style="margin:0">🗺️ 地图位置</span>' +
    styleBtn('float', '🪟') + styleBtn('inline', '📄') +
    '</div><div class="hint">' +
    '字号是<b>整块等比放大</b>（' + (z === 1 ? '当前标准' : '当前 ' + Math.round(z * 100) + '%') + '）：卡片、按钮、地图一起变大。<br>' +
    mapStyleNote(style) + '<br>' +
    '快捷键：<span class="mono">Ctrl +</span> / <span class="mono">Ctrl −</span> 调字号，<span class="mono">M</span> 开关地图。' +
    '（偏好记在本机浏览器里，不写进存档。）</div>';
}

/** ☰ 菜单用的字号区块（标题 + 按钮 + 说明） */
export function scaleSectionHtml(): string {
  return '<div class="sect-title" style="margin-top:14px">显示</div>' + scaleButtonsHtml();
}
