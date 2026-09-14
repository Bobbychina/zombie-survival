/* 「世界」面板（M20）：多世界管理 / 挑战码分享 / 幽灵据点 / 开发者统计，四块合成一个弹窗。
 *
 * 为什么放一个面板而不是四个入口：这四件事都是"关于这个存档/这张地图"的元操作，
 * 玩家找它们的心态是一样的（我先看看我有哪些世界 → 分享/接受挑战 → 看统计）。
 * 面板里的每一块都是**本机优先**：挑战码与幽灵码是纯字符串，统计只存本机，
 * 只有玩家自己按"复制/下载"才会离开这台机器。 */
import { L } from '../main';
import { PRESETS, challengeUrl, parseShareCode, randomSeed, shareCode, type Preset } from './share-core';
import {
  createWorld, emptyRegistry, normalizeRegistry, REG_KEY, removeWorld, renameWorld, slotKey, sortedWorlds,
  touchWorld, worldById, worldLine, type Registry, type WorldMeta, MAIN_KEY,
} from './worlds-core';
import { report, exportLedger, importLedger, normalizeLedger, LEDGER_KEY, type RunRecord } from './telemetry-core';
import { ghostCode, ghostLine, parseGhostCode } from './ghosts-core';
import { clearGhosts, importGhost, loadGhosts, myGhostSpec } from './ghosts';
import { regionName, type RegionType } from './regions-core';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/* ── 注册表读写 ── */
export function registry(): Registry {
  try { return normalizeRegistry(JSON.parse(localStorage.getItem(REG_KEY) || 'null')); }
  catch { return emptyRegistry(); }
}
function writeRegistry(reg: Registry): void {
  try { localStorage.setItem(REG_KEY, JSON.stringify(reg)); } catch { /* 隐私模式：本会话内还能用 */ }
}

/** 当前世界的 id（老玩家第一次进来：用现有存档的 seed 认领一个世界） */
export function ensureWorlds(): Registry {
  let reg = registry();
  const S = L.S as any;
  if (!reg.worlds.length) {
    const seed = typeof S?.seed === 'string' && S.seed ? S.seed : 'ember-01';
    const created = createWorld(reg, { name: '余烬世界', seed, preset: 'normal', now: Date.now() });
    reg = created.reg;
    writeRegistry(reg);
    L.log('🌍 已把你的存档认领成第 1 个世界「' + created.world.name + '」（种子 ' + seed + '）。', 'dim');
    return reg;
  }
  return reg;
}

/** 当前世界的元数据（天天变的那几个字段顺手同步一下） */
export function currentWorld(): WorldMeta | null {
  const reg = ensureWorlds();
  return worldById(reg, reg.activeId) ?? (reg.worlds.length ? sortedWorlds(reg)[0] : null);
}

export function syncActive(patch: Partial<WorldMeta> = {}): void {
  const reg = ensureWorlds();
  const S = L.S as any;
  const day = Number(S?.day) || 1;
  writeRegistry(touchWorld(reg, reg.activeId, { day, lastPlayed: Date.now(), ...patch }));
}

/** 切换世界：当前存档挪到自己的槽，目标世界的存档搬回主键，然后重载页面 */
export function switchWorld(id: string): boolean {
  const reg = ensureWorlds();
  const target = worldById(reg, id);
  if (!target) return false;
  if (id === reg.activeId) return false;
  try {
    const main = localStorage.getItem(MAIN_KEY);
    if (main) localStorage.setItem(slotKey(reg.activeId), main);
    const next = localStorage.getItem(slotKey(id));
    if (next) localStorage.setItem(MAIN_KEY, next);
    else localStorage.removeItem(MAIN_KEY);            // 新世界：没有存档 = 全新开局
  } catch (e) {
    L.toast('切换失败', 'localStorage 不可用（隐私模式？）', 'bad');
    console.warn('[v4] 切换世界失败', e);
    return false;
  }
  writeRegistry(touchWorld({ ...reg, activeId: id }, id, { lastPlayed: Date.now() }));
  L.toast('正在进入「' + target.name + '」', '种子 ' + target.seed, 'info');
  setTimeout(() => location.reload(), 400);
  return true;
}

/** 用一段种子（或挑战码）开新世界 */
export function startWorld(input: string, name: string): { ok: boolean; why?: string } {
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, why: '先写个种子或粘一段挑战码' };
  let seed = raw, preset: Preset = 'normal';
  if (/^ZS1-/.test(raw)) {
    const r = parseShareCode(raw);
    if (!r.ok) return { ok: false, why: r.why };
    seed = r.spec.seed; preset = r.spec.preset;
  }
  const reg = ensureWorlds();
  const { reg: next, world } = createWorld(reg, { name: name || '新世界', seed, preset, now: Date.now() });
  writeRegistry(next);
  const label = (name || '新世界');
  void world;
  L.toast('世界已创建', label + ' · ' + seed + ' · ' + PRESETS[preset].name, 'ok');
  return { ok: true };
}

export function deleteWorld(id: string): boolean {
  const reg = ensureWorlds();
  if (reg.worlds.length <= 1) return false;
  writeRegistry(removeWorld(reg, id));
  try { localStorage.removeItem(slotKey(id)); } catch { /* ignore */ }
  return true;
}
export function rename(id: string, name: string): boolean {
  const reg = ensureWorlds();
  const next = renameWorld(reg, id, name);
  writeRegistry(next);
  return !!worldById(next, id) && worldById(next, id)!.name === name.trim();
}
export function setNote(id: string, note: string): void {
  const reg = ensureWorlds();
  writeRegistry(touchWorld(reg, id, { note: note.slice(0, 40) }));
}

/* ── 台账 ── */
export function ledger(): RunRecord[] {
  try { return normalizeLedger(JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]')); } catch { return []; }
}
export function recordRun(rec: RunRecord): void {
  const list = ledger();
  list.push(rec);
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(normalizeLedger(list))); } catch { /* ignore */ }
  syncActive({ deaths: rec.kind === 'death' ? (currentWorld()?.deaths ?? 0) + 1 : currentWorld()?.deaths });
}
export function clearLedger(): void { try { localStorage.removeItem(LEDGER_KEY); } catch { /* ignore */ } }
export function mergeLedger(text: string): number {
  const inc = importLedger(text);
  if (!inc.length) return 0;
  const merged = normalizeLedger([...ledger(), ...inc]);
  try { localStorage.setItem(LEDGER_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  return inc.length;
}

/* ── 渲染 ── */
export function worldsHtml(): string {
  const reg = ensureWorlds();
  const me = currentWorld();
  const list = sortedWorlds(reg);
  const code = me ? shareCode({ seed: me.seed, preset: me.preset, by: me.name }) : '';
  let h = '<div class="wsec"><div class="sect-title">🌍 世界 <span class="badge">' + list.length + ' 个</span></div>';
  h += '<div class="wmeta-line">当前：<b>' + esc(me?.name ?? '—') + '</b> · 种子 <code>' + esc(me?.seed ?? '') + '</code> · ' +
    esc(PRESETS[me?.preset ?? 'normal'].name) + ' · 第 ' + (me?.day ?? 1) + ' 天</div>';
  for (const w of list) {
    const on = w.id === me?.id;
    h += '<div class="wrow' + (on ? ' on' : '') + '"><div class="wnm">' + (on ? '▶ ' : '') + esc(w.name) +
      (w.note ? ' <span class="hint">' + esc(w.note) + '</span>' : '') + '</div>' +
      '<div class="hint">' + esc(worldLine(w)) + '</div>' +
      '<div class="wbtns">' + (on ? '<span class="tag ok">进行中</span>' :
        '<button class="btn xs primary" onclick="V4Worlds.switch(\'' + w.id + '\')">进入</button>') +
      '<button class="btn xs" onclick="V4Worlds.rename(\'' + w.id + '\')">改名</button>' +
      (list.length > 1 ? '<button class="btn xs" onclick="V4Worlds.del(\'' + w.id + '\')">删除</button>' : '') +
      '</div></div>';
  }
  h += '<div class="wbtns"><button class="btn" onclick="V4Worlds.newWorld()">＋ 新建世界</button>' +
    '<button class="btn" onclick="V4Worlds.copy(\'' + esc(code) + '\',\'挑战码\')">复制我的挑战码</button>' +
    '<button class="btn" onclick="V4Worlds.paste()">粘贴挑战码</button></div>';
  h += '<div class="hint">挑战码 = 种子 + 开局预设（' +
    (['normal', 'lean', 'bleak'] as const).map(p => PRESETS[p].name).join(' / ') +
    '）。发给朋友，他粘进去就能开一张跟你一模一样的地图。链接：<code>' + esc(challengeUrl(code).slice(0, 68)) + '…</code></div>';
  h += '</div>';
  return h;
}

export function ghostsHtml(): string {
  const list = loadGhosts();
  const spec = myGhostSpec((L.S as any)?.name || '幸存者', '来拿啊。');
  let h = '<div class="wsec"><div class="sect-title">👻 幽灵据点（异步联机） <span class="badge">' + list.filter(g => !g.cleared).length + ' 个待打</span></div>';
  h += '<div class="hint">把自己安全屋仓库压成一段「幽灵码」，朋友粘进去，他的地图上就会长出你的据点；' +
    '打赢的人能抢走你仓库里的一部分。<b>抢的是快照，你本人的存档不会少任何东西</b>。</div>';
  if (spec) h += '<div class="wbtns"><button class="btn" onclick="V4Worlds.myGhost()">生成我的幽灵码</button>' +
    '<button class="btn" onclick="V4Worlds.pasteGhost()">粘贴幽灵码</button>' +
    (list.length ? '<button class="btn xs" onclick="V4Worlds.clearGhosts()">清空全部幽灵</button>' : '') + '</div>';
  for (const g of list) {
    h += '<div class="wrow' + (g.cleared ? ' done' : '') + '"><div class="wnm">' + (g.cleared ? '✅ ' : '👻 ') + esc(g.spec.owner) +
      ' 的据点</div><div class="hint">' + esc(ghostLine(g.spec)) + ' · ' + esc(g.spec.tag) + '</div></div>';
  }
  h += '<div class="hint">公共池（自动上传/拉取别人的幽灵）还没做——需要先绑账号并明确同意，留给下一轮。</div></div>';
  return h;
}

export function statsHtml(): string {
  const list = ledger();
  const r = report(list);
  let h = '<div class="wsec"><div class="sect-title">📊 开发者统计（只存本机） <span class="badge">' + r.runs + ' 局</span></div>';
  h += '<div class="wmeta-line">' + esc(r.verdict) + '</div>';
  h += '<div class="hint">平均活到第 ' + r.avgDay + ' 天（中位 ' + r.medianDay + '）· 死亡 ' + r.deaths + ' 次 · 通关/结局 ' + r.endings + ' 次</div>';
  if (r.hardest.length) {
    h += '<div class="hint">最难：' + r.hardest.map(x => esc(x.label) + '(' + x.deaths + ')').join(' · ') + '</div>';
    h += '<div class="hint">最易：' + r.easiest.map(x => esc(x.label) + '(' + x.deaths + ')').join(' · ') + '</div>';
  }
  if (r.causes.length) h += '<div class="hint">死因：' + r.causes.map(c => esc(c.cause.slice(0, 12)) + '×' + c.n).join(' · ') + '</div>';
  h += '<div class="wbtns"><button class="btn" onclick="V4Worlds.exportRuns()">导出匿名统计</button>' +
    '<button class="btn" onclick="V4Worlds.importRuns()">合并别人的统计</button>' +
    '<button class="btn xs" onclick="V4Worlds.clearRuns()">清空台账</button></div>';
  h += '<div class="hint">导出内容只有：天数 / 死因 / 区域 / 击杀与材料（都分桶）× 天级时间。没有账号、没有存档内容、不会自动联网。</div></div>';
  return h;
}

export function panelHtml(): string {
  return '<div class="v4worlds">' + worldsHtml() + ghostsHtml() + statsHtml() + '</div>';
}

/* ── 交互（内联 onclick 用） ── */
function copyText(text: string, what: string): void {
  try {
    void navigator.clipboard?.writeText(text);
    L.toast(what + '已复制', text.slice(0, 42) + (text.length > 42 ? '…' : ''), 'ok');
  } catch {
    L.modal({ title: '手动复制', body: '<textarea class="wcopy" readonly>' + esc(text) + '</textarea>' });
  }
}

export const V4Worlds = {
  open(): void {
    ensureWorlds();
    L.modal({ title: '🌍 世界 · 分享 · 幽灵据点 · 统计', body: panelHtml() });
  },
  switch(id: string): void { switchWorld(id); },
  del(id: string): void { if (deleteWorld(id)) { L.toast('已删除世界', '', 'info'); L.render(); } },
  rename(id: string): void {
    const w = worldById(registry(), id);
    L.modal({ title: '改名', body: '<div class="hint">给这个世界起个名字（≤16 字）</div>' +
      '<input class="winput" id="v4-rename" value="' + esc(w?.name ?? '') + '" maxlength="16">' +
      '<div class="wbtns"><button class="btn primary" onclick="V4Worlds.renameGo(\'' + id + '\')">保存</button></div>' });
  },
  renameGo(id: string): void {
    const el = document.getElementById('v4-rename') as HTMLInputElement | null;
    if (el && rename(id, el.value)) { L.toast('改好了', el.value, 'ok'); V4Worlds.open(); }
  },
  newWorld(): void {
    L.modal({ title: '新建世界', body: '<div class="hint">种子决定地图（12×12 大区 + 每区 24×24）。留空就随机一张。</div>' +
      '<input class="winput" id="v4-newworld" placeholder="' + esc(randomSeed()) + '" maxlength="48">' +
      '<div class="hint">开局预设：' + (['normal', 'lean', 'bleak'] as const).map(p => PRESETS[p].name + '（' + PRESETS[p].desc + '）').join('；') + '</div>' +
      '<div class="wbtns"><button class="btn primary" onclick="V4Worlds.newGo()">创建</button>' +
      '<button class="btn" onclick="V4Worlds.newGo(true)">用随机种子</button></div>' });
  },
  newGo(random = false): void {
    const el = document.getElementById('v4-newworld') as HTMLInputElement | null;
    const seed = random || !el?.value.trim() ? randomSeed() : el!.value.trim();
    const r = startWorld(seed, '世界 ' + (registry().worlds.length + 1));
    if (!r.ok) { L.toast('建不了', r.why || '', 'bad'); return; }
    setTimeout(() => location.reload(), 500);
  },
  paste(): void {
    L.modal({ title: '粘贴挑战码', body: '<div class="hint">朋友发来的 ZS1-… 挑战码，粘进来就能开一张同样的地图。</div>' +
      '<input class="winput" id="v4-code" placeholder="ZS1-…" maxlength="200">' +
      '<div class="wbtns"><button class="btn primary" onclick="V4Worlds.pasteGo()">创建并进入</button></div>' });
  },
  pasteGo(): void {
    const el = document.getElementById('v4-code') as HTMLInputElement | null;
    const r = startWorld(el?.value ?? '', '朋友的挑战');
    if (!r.ok) { L.toast('读不了这个码', r.why || '', 'bad'); return; }
    setTimeout(() => location.reload(), 500);
  },
  myGhost(): void {
    const spec = myGhostSpec((L.S as any)?.name || '幸存者', '来拿啊。');
    if (!spec) { L.toast('造不出快照', '', 'bad'); return; }
    copyText(ghostCode(spec), '幽灵码');
  },
  pasteGhost(): void {
    L.modal({ title: '粘贴幽灵码', body: '<div class="hint">ZG1-… 的幽灵码。打赢能拿到对方仓库的一部分（对方存档不受影响）。</div>' +
      '<input class="winput" id="v4-ghost" placeholder="ZG1-…" maxlength="300">' +
      '<div class="wbtns"><button class="btn primary" onclick="V4Worlds.pasteGhostGo()">挂到我的地图上</button></div>' });
  },
  pasteGhostGo(): void {
    const el = document.getElementById('v4-ghost') as HTMLInputElement | null;
    const r = importGhost(el?.value ?? '');
    if (!r.ok) { L.toast('挂不上', r.why || '', 'bad'); return; }
    L.closeAllModals(); L.render();
  },
  clearGhosts(): void { clearGhosts(); L.toast('已清空幽灵据点', '', 'info'); V4Worlds.open(); },
  copy(text: string, what: string): void { copyText(text, what); },
  exportRuns(): void { copyText(exportLedger(ledger()), '匿名统计'); },
  importRuns(): void {
    L.modal({ title: '合并统计', body: '<div class="hint">把别人导出的 JSON 粘进来，会合并进本机台账。</div>' +
      '<textarea class="wcopy" id="v4-runs" placeholder=\'{"v":1,...}\'></textarea>' +
      '<div class="wbtns"><button class="btn primary" onclick="V4Worlds.importRunsGo()">合并</button></div>' });
  },
  importRunsGo(): void {
    const el = document.getElementById('v4-runs') as HTMLTextAreaElement | null;
    const n = mergeLedger(el?.value ?? '');
    L.toast(n ? '合并了 ' + n + ' 条' : '没读到有效记录', '', n ? 'ok' : 'bad');
    V4Worlds.open();
  },
  clearRuns(): void { clearLedger(); L.toast('台账已清空', '', 'info'); V4Worlds.open(); },
};

/** 区域类型标签（面板里显示用；导出去重会用到，所以留个引用） */
export const typeLabelOf = (t: RegionType): string => regionName(t);
