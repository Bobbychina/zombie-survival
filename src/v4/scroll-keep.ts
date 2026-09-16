/**
 * M43：滚动位置保持（用户报障：「为啥每次行动后滚动会自动回到顶上，这不方便」）。
 *
 * 根因：legacy 的 `render()` 每次都把 `#view` 的内容整块换掉，然后**无条件** `#view.scrollTop = 0`。
 * 而每次搜刮/休整/睡觉/制作都会走一次 render —— 玩家滚到「采集 / 水体 / 菜园 / 今夜」点一下，
 * 屏幕就跳回顶部，等于每一步都要重新滚一遍（宽而矮的窗口下卡片墙是单列、内容很长，尤其难受）。
 *
 * 这里的策略（纯逻辑 + 一段 DOM 快照/还原）：
 *  ① 换页签 → 回顶部（新页面应该从头看）；
 *  ② 同页签的自动刷新 → 还原原来的偏移（浏览器会自己夹到新内容高度，内容变短也不会停在半空）；
 *  ③ 日志面板：只有**本来就在底部**时才自动跟到最新一行；玩家手动往上翻看剧情时不许被拽走。
 */

export interface ScrollBox { scrollTop: number; scrollHeight: number; clientHeight: number }

/** 这个滚动容器是不是"贴着底部"。默认可差 **48px ≈ 一行半**：日志面板的行高 30~40px，
    如果只给 24px（比一行还小），"贴底"这件事会在每次追加后差一行、被判定成"玩家翻上去了"，
    于是新日志再也跟不上（实测就是这个 37px 的缝）。手指往上滑一两行也算"看过就走"，
    真要看历史的人会滑得更远（几百像素），不会被误伤。 */
export function shouldStickToBottom(box: ScrollBox | null | undefined, slack = 48): boolean {
  if (!box) return false;
  const { scrollTop, scrollHeight, clientHeight } = box;
  if (![scrollTop, scrollHeight, clientHeight].every(v => Number.isFinite(v))) return false;
  if (scrollHeight <= clientHeight) return true;                 // 根本没得滚：贴着底部（新内容来了就往下跟）
  return scrollHeight - scrollTop - clientHeight <= Math.max(0, slack);
}

/** 换页签时要重置的容器；其余容器一律保留偏移 */
export function keepOffsets(snap: Record<string, number>, opts: { resetView?: boolean } = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(snap || {})) {
    out[k] = (opts.resetView && k === '#view') ? 0 : Math.max(0, Math.floor(snap[k] || 0));
  }
  return out;
}

/** 需要跟着 render 一起保住的滚动容器（都在 #view 里面或与它同级） */
export const KEEP_SELECTORS = ['#view', '#log', '#v4cards', '#v4mapwin .mwbody', '.v4world .wmapwrap'];

const doc = (): Document | null => (typeof document === 'undefined' ? null : document);

/** 记下这些容器当前的滚动偏移 */
export function snapshotScroll(root?: Document | null): Record<string, number> {
  const d = root ?? doc();
  const out: Record<string, number> = {};
  if (!d) return out;
  for (const sel of KEEP_SELECTORS) {
    const el = d.querySelector(sel) as HTMLElement | null;
    if (el && el.scrollTop > 0) out[sel] = el.scrollTop;
  }
  return out;
}

/**
 * 还原偏移。元素可能被 render 换掉（`#v4cards` / `#v4mapwin` 里的地图卡是 v4 那边重建的），
 * 所以除了立刻还原一次，还会在下一帧再看一眼 —— 这一帧才建出来的容器也能接上原来的位置。
 * @returns 立刻成功还原的容器数量（探针用）
 */
export function restoreScroll(snap: Record<string, number>, opts: { skip?: string[]; root?: Document | null } = {}): number {
  const d = opts.root ?? doc();
  if (!d || !snap) return 0;
  const skip = new Set(opts.skip || []);
  const apply = (retry: boolean): number => {
    let n = 0;
    for (const sel of Object.keys(snap)) {
      if (skip.has(sel)) continue;
      const el = d.querySelector(sel) as HTMLElement | null;
      if (!el) continue;
      const want = Math.max(0, Math.floor(snap[sel] || 0));
      if (el.scrollTop === want) { if (!retry) n++; continue; }
      el.scrollTop = want;
      /* 内容变短时浏览器会夹到最大值：夹过之后就别再试了（否则会来回较劲） */
      if (el.scrollTop === want || !retry) n++;
    }
    return n;
  };
  const now = apply(false);
  try {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { apply(true); });
    }
  } catch { /* 没有 rAF 就算了（立刻那一次已经生效） */ }
  return now;
}
