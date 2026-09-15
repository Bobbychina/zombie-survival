/* M32 · 界面适配的**运行时**：字号档位 + 地图悬浮窗。偏好落在 localStorage（ui-scale-core 那套纯逻辑）。
 *
 * 为什么字号用 `zoom` 而不是把几百条 `font-size` 全改成 `rem`：
 *   legacy 的样式表里全是 px 字号（几百处），一个个换既容易漏、又会和 `fitMap` 这类"按像素算尺寸"的
 *   代码打架。`zoom` 是**整块等比放大**（字号、间距、按钮命中区一起长），Chromium 原生支持，
 *   而且它只在卡片区生效 —— 视口、vw/vh、fixed 定位都不受影响，布局账不会崩。
 *   代价：`zoom` 之后 getBoundingClientRect 返回的是**缩放后**的值，所以 fitMap 里的换算要除一次 zoom。
 */
import { L } from '../main';
import { FS_KEY, clampFs, fsLabel, readPrefs, scaleStatus, stepFs, writePrefs, type UiPrefs } from './ui-scale-core';

let prefs: UiPrefs = { fs: 100, mapOpen: true };
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

/** 把字号落到 DOM：CSS 变量 `--fs`（字号）+ 卡片区与地图窗的 zoom。
    **每次 mountWorldPanel 之后都要调一次** —— #v4cards 是那之后才被创建出来的。 */
export function applyScale(): void {
  const p = ensure();
  const z = p.fs / 100;
  try {
    const root = document.documentElement;
    root.style.setProperty('--fs', String(z));
    root.dataset.fs = String(p.fs);
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
  L.toast('字号：' + fsLabel(p.fs) + '（' + p.fs + '%）', '整块界面等比放大；地图在右上角悬浮窗里。', 'info');
  return p.fs;
}
export function stepFsBtn(dir: number): number {
  const p = ensure();
  p.fs = stepFs(p.fs, dir);
  writePrefs(store, p);
  applyScale();
  try { L.render(); } catch { /* 还没 boot 完 */ }
  L.toast('字号：' + fsLabel(p.fs) + '（' + p.fs + '%）', '整块界面等比放大；地图在右上角悬浮窗里。', 'info');
  return p.fs;
}
export const fsName = (): string => fsLabel(ensure().fs);

/** 地图悬浮窗开关（任何页签都能开） */
export function toggleMap(force?: boolean): boolean {
  const p = ensure();
  p.mapOpen = typeof force === 'boolean' ? force : !p.mapOpen;
  writePrefs(store, p);
  try { paintMapOverlay(); } catch (e) { console.warn('[v4] 地图悬浮窗切换失败', e); }
  return p.mapOpen;
}

/** 悬浮窗的显隐 + 头部文案（地图内容本身由 world-ui 的 mountWorldPanel 填） */
export function paintMapOverlay(): void {
  const p = ensure();
  const win = document.getElementById('v4mapwin');
  if (!win) return;
  win.classList.toggle('open', p.mapOpen);
  win.classList.toggle('closed', !p.mapOpen);
  const btn = document.getElementById('btn-v4map');
  if (btn) { btn.classList.toggle('on', p.mapOpen); btn.setAttribute('aria-expanded', String(p.mapOpen)); }
  const body = win.querySelector('.mwbody') as HTMLElement | null;
  if (body) body.style.display = p.mapOpen ? '' : 'none';
}

/** 探针/调试：一次性把状态交出去 */
export const scaleStatusNow = () => ({ ...scaleStatus(ensure()), zoomNow: zoomNow(), canOpenMap: !!document.getElementById('v4mapwin') });

/** 折叠/展开后要重算地图格子（悬浮窗尺寸变了） */
export function paintMap(): void { paintMapOverlay(); }
export function scaleButtonsHtml(): string {
  const p = ensure();
  const z = p.fs / 100;
  return '<div class="row" style="gap:4px;align-items:center">' +
    '<button class="btn sm" onclick="V4Scale.step(-1)" title="字号调小一档">A−</button>' +
    '<span class="chip" style="min-width:74px;text-align:center">🔠 <b>' + fsLabel(p.fs) + '</b> ' + p.fs + '%</span>' +
    '<button class="btn sm" onclick="V4Scale.step(1)" title="字号调大一档">A+</button>' +
    '</div><div class="hint">字号是<b>整块等比放大</b>（' + (z === 1 ? '当前标准' : '当前 ' + Math.round(z * 100) + '%') +
    '）：卡片、按钮、地图一起变大；地图搬进右上角的悬浮窗了，所以大字也有地方放。<br>' +
    '快捷键：<span class="mono">Ctrl +</span> / <span class="mono">Ctrl −</span> 调字号，<span class="mono">M</span> 开关地图。' +
    '（偏好记在本机浏览器里，不写进存档。）</div>';
}

/** ☰ 菜单用的字号区块（标题 + 按钮 + 说明） */
export function scaleSectionHtml(): string {
  return '<div class="sect-title" style="margin-top:14px">显示</div>' + scaleButtonsHtml();
}
