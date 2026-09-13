/* M19：局部地图（24×24）的两条新规则，都是用户点名的：
   ① 危险度"越深越难"——离安全屋越远越危险，且必须**一路走得过去**（相邻差 ≤1，没有断崖）；
   ② 建筑分布（用户："我没啥好的思路你看着办"）——密度用噪声成片 + 距离衰减，
      内容用**深度偏置**：日用品靠家、硬货在深处，于是"越深越难"同时意味着"越深越肥"。
   顺带把图 dump 成 ASCII（docs/_m19_mapdump.md），因为数字断言看不出"这张图好不好玩"。 */
import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { generateWorld, WORLD_W, WORLD_H, bkey } from '../src/v4/worldgen';
import { POIS } from '../src/v4/pois';
import { buildRegions, regionById, regionSeed } from '../src/v4/regions-core';
import type { Block } from '../src/types';

const REG = buildRegions('m19-test');
const SEEDS = [0, 3, 7].map(i => REG[i * 7 % 144].id);
const worlds = SEEDS.map(id => {
  const def = regionById(id) ?? REG[0];
  return { id, w: generateWorld(regionSeed('m19-test', id), { bias: def.biomeBias, label: def.name }) };
});
const d2home = (w: { home: { x: number; y: number } }, b: Block) => Math.max(Math.abs(b.x - w.home.x), Math.abs(b.y - w.home.y));
const allBlocks = (w: ReturnType<typeof generateWorld>) => Object.keys(w.blocks).map(k => w.blocks[k]);

describe('M19 局部地图：越深越难', () => {
  it('家的 3×3 永远是安全区（危险 1）', () => {
    for (const { w, id } of worlds) {
      for (const b of allBlocks(w)) if (d2home(w, b) <= 1) expect(b.danger, id + ' 家门口不是安全区').toBe(1);
    }
  });

  it('危险度随离家的距离单调不减（分三段的粗粒度：内圈 < 中圈 < 外圈），且最外圈 ≥4', () => {
    for (const { w, id } of worlds) {
      const maxD = Math.max(...allBlocks(w).map(b => d2home(w, b)));
      /* 允许 ±1 的局部噪声，所以按"内 / 中 / 外"三段比平均值——单环对比会被噪声打乱 */
      const seg = (lo: number, hi: number) => {
        const xs = allBlocks(w).filter(b => d2home(w, b) >= lo && d2home(w, b) <= hi).map(b => b.danger);
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      };
      const inner = seg(2, 4), mid = seg(5, 8), outer = seg(9, maxD);
      expect(inner, id + ' 内圈 ' + inner.toFixed(2)).toBeLessThan(mid);
      expect(mid, id + ' 中圈 ' + mid.toFixed(2)).toBeLessThan(outer);
      const outerAvg = seg(maxD - 1, maxD);
      expect(outerAvg, id + ' 最外圈平均危险只有 ' + outerAvg.toFixed(2)).toBeGreaterThanOrEqual(4.5);
      expect(Math.max(...allBlocks(w).map(b => b.danger))).toBe(5);
      expect(new Set(allBlocks(w).map(b => b.danger)).size).toBe(5);      // 1~5 都用上
    }
  });

  it('相邻格最多差 1 档（"越深越难"要能一路走过去，不能是墙）', () => {
    const NB = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const { w, id } of worlds) {
      for (const b of allBlocks(w)) {
        for (const [dx, dy] of NB) {
          const nb = w.blocks[bkey(b.x + dx, b.y + dy)];
          if (!nb) continue;
          expect(Math.abs(nb.danger - b.danger), id + '：(' + b.x + ',' + b.y + ') 危险 ' + b.danger + ' 挨着危险 ' + nb.danger)
            .toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('水域不会变成"安全区"（安全圈之外的水里至少危险 2）', () => {
    for (const { w, id } of worlds) {
      for (const b of allBlocks(w)) {
        if (b.biome !== 'water' || d2home(w, b) <= 1) continue;    // 家门口那一圈永远按安全区算
        expect(b.danger, id + ' 水里太安全').toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('M19 局部地图：建筑分布（噪声成片 + 深度偏置）', () => {
  const poiBlocks = (w: ReturnType<typeof generateWorld>) => allBlocks(w).filter(b => b.poi);

  it('建筑不撒在不能去的地方（不压水、不压公路；沉没基地本来就该在水下）', () => {
    for (const { w, id } of worlds) {
      for (const b of poiBlocks(w)) {
        if (b.poi === 'sunken') { expect(b.biome, id + '：沉没基地不在水下').toBe('water'); continue; }
        expect(b.biome, id + '：' + b.poi + ' 长在水里').not.toBe('water');
        expect(b.biome, id + '：' + b.poi + ' 长在公路上').not.toBe('highway');
      }
    }
  });

  it('日用品靠家、硬货在深处（深度偏置真的生效）', () => {
    const DEEP = ['military', 'prison', 'megamart', 'mall', 'bunker', 'depot', 'buildmart', 'warehouse', 'waterworks', 'radio', 'outpost'];
    const DAILY = ['market', 'pharmacy', 'gas', 'garage', 'hospital', 'clinic', 'school', 'farm', 'camp'];
    let deepSum = 0, deepN = 0, dailySum = 0, dailyN = 0;
    for (const { w } of worlds) {
      for (const b of poiBlocks(w)) {
        const d = d2home(w, b);
        if (DEEP.includes(b.poi!)) { deepSum += d; deepN++; }
        if (DAILY.includes(b.poi!)) { dailySum += d; dailyN++; }
      }
    }
    const deepAvg = deepSum / Math.max(1, deepN);
    const dailyAvg = dailySum / Math.max(1, dailyN);
    expect(deepN, '一张图里得有硬货').toBeGreaterThan(6);
    expect(dailyN, '一张图里得有日用品').toBeGreaterThan(6);
    expect(deepAvg, '硬货平均离家 ' + deepAvg.toFixed(1) + ' 格，日用品 ' + dailyAvg.toFixed(1) + ' 格').toBeGreaterThan(dailyAvg);
  });

  it('保底：家附近一定有日用品，十来格内一定找得到车（不然主线/载具会卡死）', () => {
    for (const { w, id } of worlds) {
      const near = poiBlocks(w).filter(b => d2home(w, b) <= 8);
      expect(near.length, id + ' 家附近 8 格内一个建筑都没有').toBeGreaterThanOrEqual(3);
      expect(near.some(b => ['market', 'pharmacy', 'clinic', 'hospital'].includes(b.poi!)), id + ' 家附近没有补给点').toBe(true);
      const veh = poiBlocks(w).filter(b => b.poi && POIS[b.poi].feat === 'vehicle');
      expect(veh.length, id + ' 整张图没有修车点/载具点').toBeGreaterThan(0);
      expect(Math.min(...veh.map(b => d2home(w, b))), id + ' 最近的修车点太远').toBeLessThanOrEqual(11);
    }
  });

  it('建筑是成片的（噪声密度），不是均匀撒胡椒面', () => {
    for (const { w, id } of worlds) {
      /* 把图切成 6×6 个 4×4 窗口：既要有"忙碌街区"（≥4 个建筑），也要有"空地"（0 个） */
      const win: number[] = [];
      for (let wy = 0; wy < 6; wy++) for (let wx = 0; wx < 6; wx++) {
        let n = 0;
        for (let y = wy * 4; y < wy * 4 + 4; y++) for (let x = wx * 4; x < wx * 4 + 4; x++) {
          const b = w.blocks[bkey(x, y)];
          if (b && b.poi) n++;
        }
        win.push(n);
      }
      const busy = win.filter(n => n >= 4).length;
      const empty = win.filter(n => n === 0).length;
      expect(busy, id + ' 没有成片的街区').toBeGreaterThanOrEqual(2);
      expect(empty, id + ' 全图都是房子，没有空地').toBeGreaterThanOrEqual(4);
    }
  });
});

describe('M19 读图产物', () => {
  it('把危险度与建筑分布 dump 成 ASCII（docs/_m19_mapdump.md）', () => {
    const lines: string[] = ['# M19 局部地图 dump（越深越难 + 建筑分布，读图用，不是断言）', '',
      '危险度：数字 1~5；建筑：字母（M 超市 / P 药房 / G 加油站 / C 汽修 / H 医院 / m 军械 / # 其它），'.replace(/，$/, ''),
      '房子格用大写字母、空格 = 无建筑；◆ = 安全屋，L = 实验室', ''];
    for (const { id, w } of worlds) {
      lines.push(`## ${id}（危险度）`, '```');
      for (let y = 0; y < WORLD_H; y++) {
        let s = '';
        for (let x = 0; x < WORLD_W; x++) s += w.blocks[bkey(x, y)].danger;
        lines.push(s);
      }
      lines.push('```', '', `## ${id}（建筑）`, '```');
      for (let y = 0; y < WORLD_H; y++) {
        let s = '';
        for (let x = 0; x < WORLD_W; x++) {
          const b = w.blocks[bkey(x, y)];
          const home = b.x === w.home.x && b.y === w.home.y;
          const lab = b.x === w.lab.x && b.y === w.lab.y;
          if (home) s += '◆';
          else if (lab) s += 'L';
          else if (b.poi) s += b.poi === 'market' ? 'm' : b.poi === 'pharmacy' ? 'p' : b.poi === 'gas' ? 'g' : b.poi === 'garage' ? 'c' : b.poi === 'hospital' ? 'h' : '#';
          else s += '.';
        }
        lines.push(s);
      }
      lines.push('```', '');
    }
    writeFileSync('docs/_m19_mapdump.md', lines.join('\n'), 'utf8');
    expect(worlds.length).toBe(3);
  });
});
