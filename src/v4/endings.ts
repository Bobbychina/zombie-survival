/* M15 结局的接线层：解析 → 记录到存档 → 写日志 → 弹结局卡 → 任务页的"结局档案"。
   纯逻辑在 endings-core.ts（有单测），这里只碰 legacy 的 modal/log/toast 与存档字段。
   触发点（legacy 里四处，各一行）：
     finalVictory() → 'won'    rescueEnding() → 'rescue'
     gameOver()     → 'dead'   enterEndless() → 'endless' */
import { L } from '../main';
import {
  ENDINGS, archiveTitle, endingById, endingLines, ensureEndings, resolveEnding, unlockEnding,
  type EndingCtx, type EndingDef, type EndingKind,
} from './endings-core';
import { ensureStory } from './story-core';

const S = () => L.S as any;

/** 这一档的结局判定上下文 */
export function endingCtx(kind: EndingKind, extra: { inLab?: boolean } = {}): EndingCtx {
  const s = S();
  const story = ensureStory(s.story);
  return {
    kind,
    day: s.day || 1,
    choices: { ...(story.choices || {}) },
    inLab: extra.inLab ?? !!s.flags?.finalTried,
    chapters: story.chapter || 0,
    kills: s.stats?.kills || 0,
    unlocked: ensureEndings(s.endings),
  };
}

/** 结算并展示一个结局（重复触发同一结局不会重复弹卡；只在第一次解锁时提示"新结局"） */
export function showEnding(kind: EndingKind, extra: { inLab?: boolean; silent?: boolean } = {}): EndingDef {
  const s = S();
  const ctx = endingCtx(kind, extra);
  const def = resolveEnding(ctx);
  const { list, isNew } = unlockEnding(ensureEndings(s.endings), def.id);
  s.endings = list;

  const lines = endingLines(def, ctx);
  L.hr();
  L.log('🎬 结局 · ' + def.title + '（' + def.tag + '）', 'system');
  for (const t of lines) L.log('　 ' + t, 'narrative');
  L.log('　 📜 ' + def.tip, 'dim');
  L.log('　 结局档案：' + archiveTitle(list), 'info');
  if (isNew) L.log('　 ✨ 新结局已解锁（' + list.length + '/' + ENDINGS.length + '）', 'success');

  if (!extra.silent) {
    L.modal({
      title: '🎬 结局 · ' + def.title,
      sticky: true,
      body: '<p class="muted" style="margin-bottom:10px">' + def.sub + '　<span class="tag">' + def.tag + '</span></p>' +
        lines.map(t => '<p style="font-size:13px;line-height:1.8;margin-bottom:8px">' + t + '</p>').join('') +
        '<p class="muted" style="margin-top:10px">' + def.tip + '</p>' +
        '<p class="hint" style="margin-top:8px">结局档案 ' + list.length + ' / ' + ENDINGS.length +
        '（每解锁一个会记在存档里，跨周目保留）</p>',
      footer: '<button class="btn" data-close>继续</button>',
    });
  }
  L.render();
  L.autosave();
  return def;
}

/** 任务页：结局档案（已解锁的给标题+总结，未解锁的给提示条件） */
export function endingsHtml(): string {
  const s = S();
  const list = ensureEndings(s.endings);
  let h = '<div class="sect-title">结局档案 <span class="badge">' + archiveTitle(list) + '</span></div>';
  h += '<div class="grid g2">';
  for (const e of ENDINGS) {
    const got = list.includes(e.id);
    h += '<div class="lrow v4end' + (got ? ' ok' : '') + '">' +
      '<div class="row"><span class="nm">' + (got ? '✅ ' : '🔒 ') + (got ? e.title : '？？？') + '</span><span class="spacer"></span>' +
      '<span class="tag">' + e.tag + '</span></div>' +
      '<div class="hint">' + (got ? e.tip : '还没走到的收束') + '</div>' +
      '</div>';
  }
  h += '</div>';
  return h;
}

/** 当前档"最接近"的结局（探索页摘要/统计页用；不写入存档） */
export function peekEnding(): EndingDef {
  const s = S();
  const kind: EndingKind = s.flags?.endless ? 'endless' : s.flags?.won ? 'won' : 'rescue';
  return resolveEnding(endingCtx(kind));
}

export const V4Endings = { show: showEnding, list: () => ensureEndings(S().endings), html: endingsHtml, all: ENDINGS, byId: endingById };
