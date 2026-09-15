/**
 * M33 教程沙盒 · 运行时（父页面这一侧）：章节壳 + 独立 iframe（真平行世界）+ 目标清单。
 *
 * 隔离口径（用户拍板「完全隔离」）：沙盒跑在**独立 iframe** 里，那个 iframe 走 `?sandbox=1`，
 * 于是它不读主档、不落盘（legacy 的 writeSave 直接 return）、不弹新手教程、☰ 菜单里也没有
 * 存档/世界/账号这些会写盘的东西。父页面这边只做三件事：开窗、收 iframe postMessage 出来的快照、
 * 用 sandbox-core 的纯函数判绿。**父页面拥有进度**（localStorage `zsv-lab-v1`），iframe 一个字节都不存。
 */
import { L } from '../main';
import {
  LAB_CHAPTERS, LAB_KEY, chapterBadge, chapterById, evalChapter, firstOpenChapter, isDone, markDone, mergeSticky,
  nextChapterHint, parseProgress, progressLine, sandboxUrl, serializeProgress, type LabChapter, type LabEval, type LabSnap,
} from './sandbox-core';

let root: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let cur: LabChapter | null = null;
let snap: LabSnap | null = null;
let snapAt = 0;
let listening = false;
let finished = false;
/** 本会话已达成过的目标 id（单调勾选：吃饱了再睡一觉饿下去，不该把打好的勾收回去） */
let sticky = new Set<string>();

/** 当前章节的判定（已合并"达成过"集合） */
function evalNow(): LabEval | null {
  if (!cur) return null;
  const raw = evalChapter(cur, snap);
  const merged = mergeSticky(raw, sticky);
  sticky = merged.sticky;
  return merged.ev;
}

const store = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })();
const readProg = () => parseProgress(store ? store.getItem(LAB_KEY) : null);
const writeProg = (p: ReturnType<typeof readProg>) => { try { store?.setItem(LAB_KEY, serializeProgress(p)); } catch { /* 隐私模式忽略 */ } };

export const labOpen = (): boolean => !!root;
export const labChapter = (): string | null => cur ? cur.id : null;

/** 探针/调试：一次性把沙盒状态交出去（不含 DOM 细节） */
export function labStatus() {
  const ev: LabEval | null = evalNow();
  return {
    open: !!root, ch: cur ? cur.id : null, hasFrame: !!frame,
    frameSrc: frame ? frame.getAttribute('src') : null,
    snapAgeMs: snapAt ? Date.now() - snapAt : null,
    snap, eval: ev, done: readProg().done, finished,
  };
}

/** 父页面 → iframe 的打招呼（iframe 收到就立刻回一份快照） */
function ping() { try { frame?.contentWindow?.postMessage({ __zsvLab: 1, type: 'ping' }, '*'); } catch { /* 忽略 */ } }

function onMessage(e: MessageEvent) {
  const d: any = e.data;
  if (!d || d.__zsvLab !== 1 || d.type !== 'snap') return;
  if (frame && e.source && e.source !== frame.contentWindow) return;   // 只认自己那个 iframe
  snap = d.snap as LabSnap;
  snapAt = Date.now();
  paintObjectives();
}

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', onMessage);
}

/* ── 渲染 ── */
function chapterCard(c: LabChapter): string {
  const on = cur && cur.id === c.id;
  const b = chapterBadge(c, readProg());
  const isNext = c.ready && !isDone(readProg(), c.id) && c.id === firstOpenChapter(readProg());
  return '<div class="lab-ch' + (on ? ' on' : '') + (c.ready ? '' : ' soon') + (isNext ? ' next' : '') + '" data-ch="' + c.id + '"' + (c.ready ? '' : ' aria-disabled="true"') + '>' +
    '<div class="row"><span class="nm">' + c.icon + ' ' + c.name + '</span><span class="spacer"></span>' +
    '<span class="tag ' + b.cls + '">' + b.text + '</span></div>' +
    '<div class="ds">' + c.desc + '</div></div>';
}

function objectivesHtml(): string {
  if (!cur) return '';
  const ev = evalNow();
  if (!ev) return '';
  const head = '<div class="row"><span class="nm">🎯 本章目标</span><span class="spacer"></span>' +
    '<span class="tag ' + (ev.passed ? 'key' : '') + '">' + ev.green + ' / ' + ev.total + '</span></div>';
  const rows = ev.items.map(i => '<div class="lab-obj' + (i.done ? ' done' : '') + '" data-obj="' + i.id + '">' +
    '<span class="mk">' + (i.done ? '✅' : '⬜') + '</span><span>' + i.text + '</span></div>').join('');
  const tip = ev.passed
    ? '<div class="hint" style="margin-top:8px;color:var(--accent,#5cc8ff)">🎉 全绿通关！这一章记在本机进度里了（沙盒里的东西不会进主档）。</div>' +
      '<div class="hint" style="margin-top:6px">' + nextChapterHint(readProg(), cur.id) + '</div>'
    : (snap && snap.over
      ? '<div class="hint" style="margin-top:8px;color:var(--warn,#e0b050)">你倒下了 —— 沙盒里<b>不惩罚</b>，点「↻ 重来这一章」从头再练。</div>'
      : '<div class="hint" style="margin-top:8px">在右边的沙盒里照着目标做；每 0.5 秒自动核对一次。死了也不惩罚，随时可以重来。</div>');
  return head + rows + tip;
}

/** 只重画目标清单（绝不重建 iframe —— 那会把玩家的沙盒进度冲掉） */
function paintObjectives() {
  if (!root) return;
  const box = root.querySelector('#v4lab-objectives');
  if (!box) return;
  const ev = evalNow();
  box.innerHTML = objectivesHtml();
  if (ev && ev.passed && cur && !finished) {
    finished = true;
    writeProg(markDone(readProg(), cur.id, Date.now()));
    const hint = nextChapterHint(readProg(), cur.id);
    try {
      L.log('🧪 教程沙盒：' + cur.name + ' 全绿通关。', 'success');
      L.toast('章节通关', cur.name + ' 的目标全部达成。' + hint, 'ok');
    } catch { /* 还没 boot 完 */ }
    const list = root.querySelector('#v4lab-chapters');
    if (list) list.innerHTML = LAB_CHAPTERS.map(chapterCard).join('');
    bindChapters();
    const pl = root.querySelector('#v4lab-progress');
    if (pl) pl.textContent = progressLine(readProg());
  }
}

function bindChapters() {
  if (!root) return;
  root.querySelectorAll('#v4lab-chapters .lab-ch').forEach(el => {
    const box = el as HTMLElement;
    const id = box.dataset.ch || '';
    box.onclick = () => {
      const c = chapterById(id);
      if (!c || !c.ready) { try { L.toast('这一章还没做', '其余章节会在后续批次补齐。', 'info'); } catch { /* 忽略 */ } return; }
      openChapter(c);
    };
  });
}

function openChapter(c: LabChapter) {
  cur = c; snap = null; finished = false; sticky = new Set();   // 换章/重来 = 重新算勾
  if (frame) {
    frame.src = sandboxUrl(location.href, c.id);
    const title = root?.querySelector('#v4lab-frametitle');
    if (title) title.textContent = c.icon + ' ' + c.name;
  }
  root?.querySelectorAll('#v4lab-chapters .lab-ch').forEach(el => (el as HTMLElement).classList.toggle('on', (el as HTMLElement).dataset.ch === c.id));
  paintObjectives();
  ping();
}

/** 打开沙盒：默认落在**第一个还没通关的章**（六章没有硬解锁，但新手需要"从哪开始"的答案） */
export function openLab(chId?: string) {
  const target = chId || firstOpenChapter(readProg());
  const c = chapterById(target) || LAB_CHAPTERS[0];
  if (root) { openChapter(c); return; }
  cur = c;                    // M33.1：先定当前章节再拼 HTML —— 否则首次打开时"当前章"没有任何高亮
  finished = false;
  root = document.createElement('div');
  root.id = 'v4lab';
  root.innerHTML =
    '<div class="labbox">' +
      '<div class="labhead">' +
        '<b>🧪 教程沙盒</b>' +
        '<span class="hint" style="margin:0">独立 iframe 里的平行世界：怎么玩都<b>不会写进你的主档</b>（不存档、不上传）。死了不惩罚，点「重来」就行。</span>' +
        '<span class="spacer"></span>' +
        '<span class="hint" style="margin:0" id="v4lab-progress">' + progressLine(readProg()) + '</span>' +
        '<button class="btn sm" onclick="V4Lab.reset()">↻ 重来这一章</button>' +
        '<button class="btn sm" onclick="V4Lab.close()">✕ 关闭沙盒</button>' +
      '</div>' +
      '<div class="labbody">' +
        '<div class="labside"><div class="sect-title" style="margin-top:0">章节</div><div id="v4lab-chapters">' +
          LAB_CHAPTERS.map(chapterCard).join('') +
        '</div><div class="hint" style="margin-top:10px">六章都直接可玩、没有硬解锁；建议按 1→6 的顺序走（卡上那枚 <b>👉 建议从这里开始</b> 就是下一个该做的）。' +
        '每章三条目标全绿才算过，进度只记在本机。</div></div>' +
        '<div class="labmain">' +
          '<div class="row" style="padding:4px 2px"><span class="nm" id="v4lab-frametitle">' + c.icon + ' ' + c.name + '</span>' +
          '<span class="spacer"></span><span class="hint" style="margin:0">沙盒地址带 <span class="mono">?sandbox=1</span>：不读档、不落盘</span></div>' +
          '<iframe id="v4lab-frame" title="教程沙盒" name="v4labframe" src="' + sandboxUrl(location.href, c.id) + '"></iframe>' +
        '</div>' +
        '<div class="labobj"><div id="v4lab-objectives"></div></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(root);
  frame = root.querySelector('#v4lab-frame') as HTMLIFrameElement;
  ensureListener();
  bindChapters();
  paintObjectives();
  frame.addEventListener('load', () => { ping(); setTimeout(ping, 400); });   // iframe 冷启动要等它 boot 完
  try { L.sfx('ui'); } catch { /* 忽略 */ }
}

export function closeLab() {
  if (!root) return;
  root.remove(); root = null; frame = null; cur = null; snap = null; snapAt = 0; finished = false;
}

/** 重来这一章：直接换一个 iframe 地址（沙盒没有存档，重载 = 满血重开） */
export function resetLab() {
  if (!cur) return;
  const c = cur;
  snap = null; finished = false;
  openChapter(c);
  try { L.toast('重来', c.name + ' 的沙盒已重置。', 'info'); } catch { /* 忽略 */ }
}

export const V4Lab = { open: openLab, close: closeLab, reset: resetLab, status: labStatus, resetProgress };
/** 只清本机进度（章节徽章），不动任何游戏数据 */
function resetProgress(): void { writeProg({ done: {} }); if (root) { const l = root.querySelector('#v4lab-chapters'); if (l) l.innerHTML = LAB_CHAPTERS.map(chapterCard).join(''); bindChapters(); paintObjectives(); } }
