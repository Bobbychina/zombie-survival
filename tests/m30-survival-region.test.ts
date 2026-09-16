/* M30 单测：① 湿度是天气的导出量 + 两个硬阈值的病症链（中暑/脱水/呼吸道/真菌）；
   ② 淋湿、生火率、腐坏倍率、喝水收益这些副作用；
   ③ 大区资源丰度（值噪声 + 正态化映射）；
   ④ 区域内部 24×24 的局部难度（连续噪声、不会一格一个数）。 */
import { describe, expect, it } from 'vitest';
import {
  CONDS, COND_IDS, DRY_AT, HEAT_AT, MUGGY_AT, condPenalty, condRisk, dryThirstMul, fireChance,
  forecastHumidity, humBand, humLabel, humidityOf, rotMulOf, tickCond, wetEffect, wetGain, type CondState,
} from '../src/v4/survival-core';
import {
  ABUNDANCE_MAX, ABUNDANCE_MIN, abundanceAt, abundanceTier, buildDangerGrid, dangerAt, dangerStats,
  hash32, localDanger, makeField, makePerlin,
} from '../src/v4/region-danger';
import { buildRegions } from '../src/v4/regions-core';

const mulberry = (s0: number) => { let s = s0 >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

describe('M30 湿度是天气的导出量（玩家能看天预判）', () => {
  it('下雨/暴雨最潮，晴天/热浪最干，同一季节内单调', () => {
    const s = 'summer' as const;
    const rain = humidityOf('rain', s, 0.5, false), storm = humidityOf('storm', s, 0.5, false);
    const clear = humidityOf('clear', s, 0.5, false), heat = humidityOf('heat', s, 0.5, false);
    expect(rain).toBeGreaterThan(MUGGY_AT);            // 雨天必然闷湿
    expect(storm).toBeGreaterThanOrEqual(rain);
    expect(heat).toBeLessThan(DRY_AT);                 // 热浪必然干燥
    expect(clear).toBeGreaterThan(heat);
  });

  it('室内把湿气挡掉大半（庇护所里不会闷湿到生病）', () => {
    const out = humidityOf('storm', 'spring', 0.5, false);
    const ins = humidityOf('storm', 'spring', 0.5, true);
    expect(out - ins).toBeGreaterThan(25);
    expect(humBand(ins)).not.toBe('muggy');
  });

  it('同一天之内有起伏：清晨最潮、午后最干', () => {
    const dawn = humidityOf('cloudy', 'autumn', 0.0, false);
    const noon = humidityOf('cloudy', 'autumn', 0.45, false);
    expect(dawn).toBeGreaterThan(noon);
  });

  it('档位文案：干燥 / 适宜 / 闷湿', () => {
    expect(humBand(10)).toBe('dry');
    expect(humBand(50)).toBe('ok');
    expect(humBand(92)).toBe('muggy');
    expect(humLabel(10)).toBe('干燥');
  });
});

describe('M30 病症链（阈值 → 概率得病 → 持续掉血 → 环境对了消退）', () => {
  it('干燥 + 高温会中暑与脱水，闷湿会呼吸道/真菌', () => {
    const dryHot = condRisk({ hum: 12, temp: 80, shelter: false, thi: 20 });
    expect(dryHot.gain).toContain('heatstroke');
    expect(dryHot.gain).toContain('dehydration');
    const muggyCold = condRisk({ hum: 92, temp: 30, shelter: false, thi: 80 });
    expect(muggyCold.gain).toContain('respiratory');
    const muggyHot = condRisk({ hum: 92, temp: 75, shelter: false, thi: 80 });
    expect(muggyHot.gain).toContain('fungal');
  });

  it('庇护所里不会中暑，也不会得呼吸道（有屋顶就是不一样）', () => {
    expect(condRisk({ hum: 5, temp: 95, shelter: true, thi: 80 }).gain).not.toContain('heatstroke');
    expect(condRisk({ hum: 95, temp: 20, shelter: true, thi: 80 }).gain).not.toContain('respiratory');
  });

  it('中间那段（20~85%）不给任何病：舒服区必须存在', () => {
    for (const hum of [30, 50, 70, 84]) {
      const r = condRisk({ hum, temp: 60, shelter: false, thi: 80 });
      expect(r.gain).toEqual([]);
    }
  });

  it('得病是**概率**不是必然：极端环境下必中，临界值附近大概率不得', () => {
    const extreme = tickCond(1, [], { hum: 96, temp: 75, shelter: false, thi: 80 }, () => 0.01);
    expect(extreme.next.map(c => c.id)).toContain('fungal');
    const mild = tickCond(1, [], { hum: 86, temp: 75, shelter: false, thi: 80 }, () => 0.99);
    expect(mild.next.length).toBe(0);
  });

  it('病程推进：stage 累计，重症开始掉血，环境对了才消退', () => {
    const inp = { hum: 8, temp: 85, shelter: false, thi: 90 };
    let cur: CondState[] = [{ id: 'heatstroke', since: 1, stage: 0 }];
    const r1 = tickCond(1, cur, inp, () => 0.99);       // 不会新增
    expect(r1.next[0].stage).toBe(1);
    expect(r1.hp).toBe(0);                              // stage 1 还不掉血
    cur = r1.next;
    const r2 = tickCond(1, cur, inp, () => 0.99);
    expect(r2.hp).toBeLessThan(0);                      // stage ≥2 开始掉血
    const safe = tickCond(5, r2.next, { hum: 50, temp: 50, shelter: true, thi: 90 }, () => 0.99);
    expect(safe.next.length).toBe(0);                   // 环境对了 → 消退
    expect(safe.logs.join()).toContain('缓过来了');
  });

  it('病症惩罚可叠加，但体力乘子不会变成 0', () => {
    const both: CondState[] = [{ id: 'heatstroke', since: 1, stage: 0 }, { id: 'dehydration', since: 1, stage: 0 }];
    const p = condPenalty(both);
    expect(p.apMul).toBeCloseTo(CONDS.heatstroke.apMul * CONDS.dehydration.apMul, 5);
    expect(p.apMul).toBeGreaterThan(0.4);
    expect(p.hit).toBeCloseTo(0.21, 5);
  });

  it('四种病症都有数值表与文案（缺一个 UI 就会显示 undefined）', () => {
    for (const id of COND_IDS) {
      const d = CONDS[id];
      expect(d.name.length).toBeGreaterThan(1);
      expect(d.cure.length).toBeGreaterThan(3);
      expect(d.symptom.length).toBeGreaterThan(3);
      expect(d.hud.length).toBeGreaterThan(3);
    }
  });
});

describe('M30 湿度的副作用（淋湿 / 生火 / 腐坏 / 喝水）', () => {
  it('雨雪天在外面会淋湿，进屋烘干，雨衣减到 1/4', () => {
    expect(wetGain('rain', false)).toBeGreaterThan(0);
    expect(wetGain('rain', true)).toBeLessThan(0);                 // 屋里烘干
    expect(wetGain('rain', false, true)).toBeLessThan(wetGain('rain', false));
    expect(wetGain('clear', false)).toBeLessThan(0);               // 晴天也会慢慢干
  });

  it('淋湿 60% 以上体温掉得更快（与体温系统联动）', () => {
    expect(wetEffect(10).tempMul).toBe(1);
    expect(wetEffect(70).tempMul).toBeGreaterThan(1.5);
    expect(wetEffect(70).chill).toBe(true);
  });

  it('闷湿天生火难，干燥天东西不容易坏', () => {
    expect(fireChance(92)).toBeLessThan(0.6);
    expect(fireChance(10)).toBe(1);
    expect(rotMulOf(92)).toBeGreaterThan(1.2);
    expect(rotMulOf(10)).toBeLessThan(1);
  });

  it('干燥让水分流失更快，越干越热越明显', () => {
    expect(dryThirstMul(50, 50)).toBe(1);
    expect(dryThirstMul(10, 50)).toBeGreaterThan(1.2);
    expect(dryThirstMul(10, 80)).toBeGreaterThan(dryThirstMul(10, 50));
  });

  it('天气预报把未来天气折成"该准备什么"', () => {
    const f = forecastHumidity(['rain', 'heat', 'clear'], 'summer');
    expect(f[0].kind).toBe('wet');
    expect(f[1].kind).toBe('heat');
    expect(f[1].hint).toContain('中暑');
    expect(f[0].hum).toBeGreaterThan(f[1].hum);
  });
});

describe('M30 大区资源丰度（同一套噪声，独立于危险度）', () => {
  it('值噪声可复现：同种子同坐标永远同一个值', () => {
    const a = makeField(hash32('ember-01:resources')), b = makeField(hash32('ember-01:resources'));
    for (const [x, y] of [[0, 0], [1, 1], [3.7, 2.2], [11, 11]] as const) expect(a(x, y)).toBe(b(x, y));
  });

  it('丰度落在 0.75~1.35 且**四种档位都用得上**（不是一片一样肥）', () => {
    const f = makeField(hash32('ember-01:resources'));
    const vals: number[] = [];
    const tiers = new Set<number>();
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
      const v = abundanceAt(f, c, r);
      expect(v).toBeGreaterThanOrEqual(ABUNDANCE_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(ABUNDANCE_MAX + 1e-9);
      vals.push(v); tiers.add(abundanceTier(v).tier);
    }
    expect(tiers.size).toBeGreaterThanOrEqual(3);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(avg).toBeGreaterThan(0.95);
    expect(avg).toBeLessThan(1.15);                    // 均值仍在 1 附近：整体不偏肥也不偏穷
  });

  it('丰度空间连续：相邻格不会突然从贫瘠跳到富矿', () => {
    const f = makeField(hash32('ember-02:resources'));
    for (let r = 0; r < 12; r++) for (let c = 0; c < 11; c++) {
      expect(Math.abs(abundanceAt(f, c, r) - abundanceAt(f, c + 1, r))).toBeLessThan(0.4);
    }
  });

  it('真实地图里每格都有 abundance，主城固定 1.0', () => {
    const rs = buildRegions('ember-01');
    const home = rs.find(r => r.homeBase)!;
    expect(home.abundance).toBe(1);
    expect(rs.filter(r => r.abundance > 1.1).length).toBeGreaterThan(3);
    expect(rs.filter(r => r.abundance < 0.9).length).toBeGreaterThan(3);
  });
});

describe('M30 大区难度：连续柏林场（格心采样，不会一格一个随机数）', () => {
  const opts = () => {
    const low = makePerlin(hash32('t:danger-low')), fine = makePerlin(hash32('t:danger-fine'));
    return { homeCol: 5, homeRow: 5, maxDist: 6, low, fine, cont: low, pit: { c: 9, r: 8 } };
  };

  it('dangerAt 是连续噪声场（不是"一格一个随机数"）：平均相邻差 < 0.7 档', () => {
    const o = opts();
    const ds: number[] = [];
    let worst = 0;
    for (let r = 0; r < 12; r++) for (let c = 0; c < 11; c++) {
      const d = Math.abs(dangerAt(o, c, r) - dangerAt(o, c + 1, r));
      ds.push(d); worst = Math.max(worst, d);
    }
    const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
    /* 平均差是"连续性"该看的指标：真·随机场（一格一个随机数）平均差会 >1.3。
       M51b 加了**域扭曲**（拿低频噪声揉"离主城几格"再算径向趋势），连续场因此比 M28 陡一档：
       实测平均 0.466（旧 0.392）、最坏 3.4（旧 1.7，出现在域扭曲把相邻两格拉开一两环的地方）。
       这是设计上要的代价 —— 换来的是"难度不再由第几圈决定"；
       **玩家真正看到的取整网格仍然满足"相邻最多差 1"**（收尾不变量把它钳死，下一条钉着）。 */
    expect(avg).toBeLessThan(0.7);
    expect(worst).toBeLessThan(4);
  });

  it('三个硬约束仍然成立：新手村恒 1、相邻最多差 1、五个档都用上', () => {
    const o = opts();
    const grid = buildDangerGrid(o, 12, 12);
    const st = dangerStats(grid, 5, 5);
    expect(st.maxJump).toBeLessThanOrEqual(1);
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
      const d = Math.max(Math.abs(c - 5), Math.abs(r - 5));
      if (d <= 1) expect(grid[r][c]).toBe(1);
    }
    expect([1, 2, 3, 4, 5].every(t => st.hist[t] > 0)).toBe(true);
  });

  it('区域内部（24×24）的局部难度夹在 1~5，且不会整片同一个数', () => {
    const o = opts();
    const base = dangerAt(o, 9, 8);
    const seen = new Set<number>();
    for (let r = 0; r < 24; r++) for (let c = 0; c < 24; c++) {
      const v = localDanger(o.cont!, base, c, r);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});
