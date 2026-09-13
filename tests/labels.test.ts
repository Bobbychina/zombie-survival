/* 判定文案的"人话"检查：委托/剧情面板里出现的每一个 key 都必须有中文名。
   起因：UI 上真的出现过「搜刮 hospital ×1」「击杀 hound ×3」——半中半英，
   玩家看不懂，也暴露"文案与判定没对齐"。这里对着两个真源头（pois.ts / legacy ZOMBIES）逐条核对。 */
import { describe, expect, it } from 'vitest';
import { KILL_ZH, ZONE_ZH, foeName, poiName } from '../src/v4/labels';
import { POIS } from '../src/v4/pois';
import { STORY } from '../src/v4/story-core';
import { metricLabel, rollOffers } from '../src/v4/contracts-core';
import { zombieTable } from './legacy-tables';

describe('判定文案', () => {
  it('每个 v4 POI / legacy 区域 / 丧尸都有中文名', () => {
    for (const id of Object.keys(POIS)) expect(poiName(id), 'POI ' + id).not.toBe(id);
    for (const id of Object.keys(ZONE_ZH)) expect(poiName(id), 'zone ' + id).not.toBe(id);
    for (const id of Object.keys(KILL_ZH)) expect(foeName(id), 'foe ' + id).not.toBe(id);
  });

  it('丧尸中文名与 legacy 的 ZOMBIES 表逐字一致（改名了这里会红）', () => {
    const table = zombieTable();
    expect(Object.keys(table).length).toBeGreaterThan(10);
    for (const id in table) {
      expect(KILL_ZH[id], '缺 label: ' + id).toBeTruthy();
      expect(KILL_ZH[id]).toBe(table[id].n);
    }
  });

  it('metricLabel 出来的是人话，不带英文 key', () => {
    expect(metricLabel('zone:hospital')).toBe('搜刮 医院');
    expect(metricLabel('zone:pharmacy')).toBe('搜刮 药房');
    expect(metricLabel('killBy:hound')).toBe('击杀 变异猎犬');
    expect(metricLabel('killBy:tyrant')).toBe('击杀 暴君');
    expect(metricLabel('region:jiangbei')).toBe('前往 江北工业区');
    expect(metricLabel('kills')).toBe('击杀丧尸');
  });

  it('委托板上所有委托的判定文案都不含英文 key', () => {
    for (const day of [1, 5, 15, 40]) {
      for (const o of rollOffers(day, Math.random, 3)) {
        const label = metricLabel(o.metric);
        expect(label, o.title + ' → ' + o.metric).not.toMatch(/[a-z_]{3,}/);
      }
    }
  });

  it('剧情目标的判定文案同样不含英文 key', () => {
    for (const c of STORY) for (const o of c.objs) {
      expect(metricLabel(o.metric), c.title + ' → ' + o.metric).not.toMatch(/[a-z_]{3,}/);
    }
  });
});
