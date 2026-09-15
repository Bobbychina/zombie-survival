/* M32 · 界面适配（字号 + 地图悬浮窗）的**纯逻辑**（不碰 DOM，可单测）。
 *
 * 用户反馈原话：「字体太小了，做可自定义字号适配（简化一下 GUI，把地图改成那种类似于悬浮框可折叠的模式，
 *   在哪里都能开，然后呢主要的地方全用来放行动卡片，这样大字适配会很不错）」
 *
 * 两件事：
 *   ① **字号**：5 档（100% / 115% / 130% / 145% / 160%），存浏览器偏好（**不入存档**：换设备不该带过去，
 *      也不该因为改字号就写一次存档）；UI 通过 CSS 变量 `--fs` + 卡片区 `zoom` 落地，见 styles/v4.css。
 *   ② **地图**：从"探索页里的一张卡"改成**全局悬浮窗**（任何页签都能用按钮或 `M` 键开关），
 *      于是探索页整宽留给行动卡片 —— 字号放大后卡片有地方可去。
 *   ③ **地图摆法可配置**（M34）：悬浮窗 / 嵌入页内两种，见 MapStyle。字号与地图偏好都存同一个 key。
 */

/** M34：地图怎么摆，做成可配置项（用户："把地图的悬浮或者嵌入改成可配置项"）。
 *  float  = 右上角悬浮窗（M32 起的默认：折叠后只剩小条，任何页签都能开）
 *  inline = 嵌进探索页顶部（M32 之前的形态：地图和卡片一起滚，不遮挡任何东西） */
export type MapStyle = 'float' | 'inline';
export const MAP_STYLES: readonly MapStyle[] = ['float', 'inline'];

export interface UiPrefs {
  /** 字号档位（100~160，单位 %） */
  fs: number;
  /** 地图悬浮窗开着吗（默认开：老玩家习惯一进来就看见地图）。inline 模式下它管"嵌入的地图折叠了没" */
  mapOpen: boolean;
  /** 地图摆法（悬浮窗 / 嵌入页内） */
  mapStyle: MapStyle;
}

export const FS_STEPS = [100, 115, 130, 145, 160] as const;
export const FS_MIN = 100, FS_MAX = 160;
export const FS_KEY = 'zsv-ui-v1';

/** 把任意数字吸附到最近的档位（脏数据不会让界面变成 37% 那种诡异值） */
export function clampFs(v: number): number {
  const n = Number(v);
  if (!isFinite(n)) return FS_MIN;
  let best: number = FS_MIN, bestD = Infinity;
  for (const s of FS_STEPS) { const d = Math.abs(s - n); if (d < bestD) { bestD = d; best = s; } }
  return best;
}

export const fsLabel = (fs: number): string => {
  const f = clampFs(fs);
  return f <= 100 ? '标准' : f <= 115 ? '大' : f <= 130 ? '特大' : f <= 145 ? '巨大' : '超大';
};

/** 下一档 / 上一档（到头就停住，返回同一个值 —— UI 可以据此禁用按钮） */
export function stepFs(fs: number, dir: number): number {
  const i = FS_STEPS.indexOf(clampFs(fs) as typeof FS_STEPS[number]);
  return FS_STEPS[Math.max(0, Math.min(FS_STEPS.length - 1, i + (dir > 0 ? 1 : -1)))];
}

/** 字号 → 卡片区的 zoom（1.0 / 1.15 / …）。**只放大内容，不改视口**，所以布局账不会崩。 */
export const zoomOf = (fs: number): number => clampFs(fs) / 100;

/** 估算"一屏能放几张卡"：给探针与排版自检用（大字模式卡片会变少，这是预期的） */
export const cardsPerScreen = (viewH: number, cardH: number, fs: number): number =>
  Math.max(1, Math.floor(viewH / Math.max(80, cardH * zoomOf(fs))));

export interface PrefsStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const DEFAULT_PREFS: UiPrefs = { fs: 100, mapOpen: true, mapStyle: 'float' };

/** 脏数据一律回落 float（老存档/被外部改过的 localStorage 不能让界面变成"哪都没有地图"） */
export const normalizeMapStyle = (v: unknown): MapStyle => (v === 'inline' ? 'inline' : 'float');

/** 菜单按钮上的名字 */
export const mapStyleLabel = (v: unknown): string => (normalizeMapStyle(v) === 'inline' ? '嵌入页内' : '悬浮窗');

/** 一句话说明（菜单提示 / toast / 探针共用同一口径，免得三处文案各说各的） */
export const mapStyleNote = (v: unknown): string => normalizeMapStyle(v) === 'inline'
  ? '地图嵌在探索页顶部，跟着页面一起滚（字号照样生效，折叠后靠右上角的小条打开）。'
  : '地图是右上角的悬浮窗：折叠后只剩一个小条，任何页签都能开关（快捷键 M）。';

/** 读偏好（脏数据一律回落默认值：外部改过的 localStorage 不能让界面崩） */
export function readPrefs(store: PrefsStore | null | undefined): UiPrefs {
  if (!store) return { ...DEFAULT_PREFS };
  let raw: string | null = null;
  try { raw = store.getItem(FS_KEY); } catch { return { ...DEFAULT_PREFS }; }
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const j = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      fs: j.fs === undefined ? DEFAULT_PREFS.fs : clampFs(Number(j.fs)),
      mapOpen: typeof j.mapOpen === 'boolean' ? j.mapOpen : DEFAULT_PREFS.mapOpen,
      mapStyle: normalizeMapStyle(j.mapStyle),
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function writePrefs(store: PrefsStore | null | undefined, p: UiPrefs): void {
  if (!store) return;
  try {
    store.setItem(FS_KEY, JSON.stringify({ fs: clampFs(p.fs), mapOpen: !!p.mapOpen, mapStyle: normalizeMapStyle(p.mapStyle) }));
  } catch { /* 无痕模式：忽略 */ }
}

/** 悬浮地图的标题（本地 / 大区两种口径） */
export const mapTitle = (region: boolean, regionName: string): string =>
  region ? '🌐 大区地图 · ' + regionName : '🗺️ 本地地图';

/** 悬浮窗头部那一行：区域名 + 当前坐标 + 载具 */
export function worldHeadline(regionName: string, cur: { x: number; y: number } | null, vehicleName: string): string {
  if (!cur) return regionName;
  return regionName + ' · (' + cur.x + ',' + cur.y + ')' + (vehicleName ? ' · ' + vehicleName : '');
}

/** 探针/调试：把当前状态交出去 */
export const scaleStatus = (p: UiPrefs) => ({
  fs: clampFs(p.fs), label: fsLabel(p.fs), zoom: zoomOf(p.fs), mapOpen: !!p.mapOpen,
  mapStyle: normalizeMapStyle(p.mapStyle), mapStyleLabel: mapStyleLabel(p.mapStyle), key: FS_KEY,
});
