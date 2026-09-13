/* M17.1：把元地图 dump 成 ASCII 自己读一遍——断言只能证明"我没写错"，读图才能看出"好不好看"。
   上一版就是只信断言（"144 格、危险度单调"全绿），结果地图是色块马赛克：
   居民区隔壁化工园、农田散在城里。这一版加了分带 + 平滑 + 硬约束，靠这张图验收。
   产物：docs/_m17_mapdump.md */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildRegions, TYPE_INFO, REGION_COLS, REGION_ROWS, type RegionType } from '../src/v4/regions-core';

const LETTER: Record<RegionType, string> = {
  core: 'C', residential: 'R', suburb: 'S', industry: 'I',
  military: 'M', farm: 'F', forest: 'T', water: 'W', ruins: 'X',
};

describe('M17.1 元地图 dump（人工读图）', () => {
  it('把 3 个种子的元地图写成 ASCII + 相邻同类比，落到 docs/_m17_mapdump.md', () => {
    const seeds = ['ember-01', 'regions-test', 'mig-test'];
    const lines: string[] = ['# M17.1 元地图 ASCII dump（读图用，不是断言）', '',
      '字母：C 城市核心 / R 居民区 / S 城郊 / I 工业区 / M 军事管制 / F 农田 / T 林地山区 / X 废墟 / W 水域港区 / ◆ 主城余烬', ''];
    for (const seed of seeds) {
      const T = buildRegions(seed);
      const home = T.find(r => r.homeBase)!;
      let same = 0, tot = 0, coreAdjInd = 0;
      for (const d of T) {
        for (const [dx, dy] of [[0, 1], [1, 0], [-1, 1], [1, 1]]) {
          const n = T.find(x => x.col === d.col + dx && x.row === d.row + dy);
          if (!n) continue;
          tot++;
          if (n.type === d.type) same++;
        }
        if (d.type === 'core' && T.some(n => Math.max(Math.abs(n.col - d.col), Math.abs(n.row - d.row)) === 1 && n.type === 'industry')) coreAdjInd++;
      }
      const counts: Record<string, number> = {};
      for (const d of T) counts[TYPE_INFO[d.type].label] = (counts[TYPE_INFO[d.type].label] ?? 0) + 1;
      lines.push(`## seed ${seed}`, '',
        `主城 (${home.col},${home.row}) · 危险 ${home.tier} · **相邻同类占比 ${(same / tot).toFixed(2)}**（0.15≈随机打散，0.5+ 才算成片）· 城市核心贴着工业区的格子 ${coreAdjInd} 个`, '',
        '```');
      for (let r = 0; r < REGION_ROWS; r++) {
        let line = '';
        for (let c = 0; c < REGION_COLS; c++) {
          const d = T.find(x => x.col === c && x.row === r)!;
          line += (d.homeBase ? '◆' : LETTER[d.type]) + ' ';
        }
        lines.push(line.trimEnd());
      }
      lines.push('```', '', '类型分布：' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '), '');
      /* 短名抽样：确认不再有「北西废」这种半截词 */
      lines.push('短名：' + T.map(d => d.short).join(' '), '');
      expect(T.length).toBe(REGION_COLS * REGION_ROWS);
    }
    writeFileSync('docs/_m17_mapdump.md', lines.join('\n'), 'utf8');
  });
});
