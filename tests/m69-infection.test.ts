/* M69：感染链咬合（用户硬核化路线图 · 短期第 1 项的剩下一半）——
   项目里原本有**两条互不相干**的感染：legacy 的 `S.infect`（0~100，≥35 警戒 / ≥60 每晚 +2 / 满 100 死）
   与 v4 部位伤的「感染伤口」（要消毒剂清创）。带着伤口过夜，全身感染照样自然消退 —— 这就是"不咬合"。
   现在：伤口 → 每晚 +4/处且**不再消退**；抗生素压住当晚；爆发期（≥60）伤口康复暂停。 */
import { describe, expect, it } from 'vitest';
import {
  infectNight, infectionLine, isSuppressedToday, openInfectedWounds, tickBody, treat, treatOptions,
  type BodyState,
} from '../src/v4/medical-core';

const mk = (injuries: BodyState['injuries'] = []): BodyState => ({
  parts: { head: 100, torso: 100, belly: 100, armL: 100, armR: 100, legL: 100, legR: 100 },
  injuries, bleedSince: 1,
});
const infected = (part: BodyState['injuries'][number]['part'], over: Partial<BodyState['injuries'][number]> = {}) =>
  ({ part, id: 'infected' as const, day: 1, ...over });

describe('M69 感染伤口 → 全身感染值', () => {
  it('带一处没清创的伤口过夜：感染 +4，且**不再自然消退**（吃饱喝足也一样）', () => {
    const r = infectNight({ infect: 10, openWounds: 1, hun: 90, thi: 90, medicLv: 5, suppressedToday: false });
    expect(r.infect).toBe(14);
    expect(r.woundPush).toBe(4);
    expect(r.logs[0].text).toContain('往血里灌');
  });
  it('两处伤口 = +8（线性，且封顶 100）', () => {
    expect(infectNight({ infect: 10, openWounds: 2, hun: 90, thi: 90, medicLv: 0, suppressedToday: false }).infect).toBe(18);
    expect(infectNight({ infect: 98, openWounds: 3, hun: 90, thi: 90, medicLv: 0, suppressedToday: false }).infect).toBe(100);
  });
  it('吃过抗生素（当天）：伤口不推进，而且**照旧走正常的消退/爆发规则**', () => {
    const ok = infectNight({ infect: 20, openWounds: 1, hun: 90, thi: 90, medicLv: 3, suppressedToday: true });
    expect(ok.infect).toBe(20 - (1 + 1));            // 消退 1 + medic 3 级 /3 = 1
    expect(ok.woundPush).toBe(0);
    expect(ok.logs.some(l => l.text.includes('抗生素压住'))).toBe(true);
    const burst = infectNight({ infect: 70, openWounds: 1, hun: 90, thi: 90, medicLv: 0, suppressedToday: false });
    expect(burst.infect).toBe(74);                   // 伤口 +4 优先于"爆发期 +2"
  });
  it('没有伤口时保持原样：干净身子不产生日志，虚弱 +1，吃饱 -1/-更多', () => {
    expect(infectNight({ infect: 0, openWounds: 0, hun: 100, thi: 100, medicLv: 0, suppressedToday: false }).logs.length).toBe(0);
    expect(infectNight({ infect: 10, openWounds: 0, hun: 10, thi: 10, medicLv: 0, suppressedToday: false }).infect).toBe(11);
    expect(infectNight({ infect: 10, openWounds: 0, hun: 80, thi: 80, medicLv: 3, suppressedToday: false }).infect).toBe(8);
    expect(infectNight({ infect: 61, openWounds: 0, hun: 80, thi: 80, medicLv: 9, suppressedToday: false }).infect).toBe(63);
  });
  it('统计与"今天是否压过"都只看**没清创**的感染伤口（手术后的不算）', () => {
    const b = mk([infected('armR'), infected('legL', { done: true }), infected('head', { suppressDay: 3 })]);
    expect(openInfectedWounds(b).length).toBe(2);
    expect(openInfectedWounds(b).every(i => i.id === 'infected' && !i.done)).toBe(true);
    expect(isSuppressedToday(b, 3)).toBe(true);
    expect(isSuppressedToday(b, 4)).toBe(false);
  });
});

describe('M69 抗生素压制（人体页那条按钮）', () => {
  it('对感染伤口吃抗生素：记下当天、伤口不推进；一天只能一次', () => {
    const b = mk([infected('armR')]);
    const r1 = treat(b, 'armR', 'anti', 5, 0, () => 0.1);
    expect(r1.ok).toBe(true);
    expect(r1.body!.injuries[0].suppressDay).toBe(5);
    expect(isSuppressedToday(r1.body!, 5)).toBe(true);
    const again = treat(r1.body!, 'armR', 'anti', 5, 0, () => 0.1);
    expect(again.ok).toBe(false);
    expect(again.why).toContain('今天已经吃过');
    expect(treat(r1.body!, 'armR', 'anti', 6, 0, () => 0.1).ok).toBe(true);      // 第二天还能再压
  });
  it('清创（手术）之后就不用再吃抗生素了', () => {
    const b = mk([infected('armR', { done: true })]);
    const r = treat(b, 'armR', 'anti', 5, 0, () => 0.1);
    expect(r.ok).toBe(false);
    expect(r.why).toContain('已经清创');
  });
  it('treatOptions 把抗生素列在明面上（kind=field，可反复点）', () => {
    const opts = treatOptions(mk([infected('armR')]), 'armR');
    expect(opts.find(o => o.item === 'anti')).toMatchObject({ kind: 'field', done: false });
    expect(opts.find(o => o.item === 'antiseptic')).toMatchObject({ kind: 'surgery' });
    expect(treatOptions(mk([infected('armR', { done: true })]), 'armR').find(o => o.item === 'anti')).toBeUndefined();
  });
});

describe('M69 爆发期让伤口康复暂停', () => {
  it('感染 ≥60 时，手术过的伤口当晚不长也不结案', () => {
    const b = mk([{ part: 'legR', id: 'fracture', day: 1, done: true, field: true }]);
    const sick = tickBody(b, 9, { nutrition: 100, resting: true, infect: 70 });
    expect(sick.healed.length).toBe(0);
    expect(sick.body.injuries.length).toBe(1);
    expect(sick.logs.some(l => l.includes('爆发期'))).toBe(true);
    const well = tickBody(b, 9, { nutrition: 100, resting: true, infect: 10 });
    expect(well.healed.length).toBe(1);              // 4 天 ≥ recoverDays 3 → 结案
  });
});

describe('M69 人体页/HUD 的感染总览', () => {
  it('档位（潜伏 / 警戒 / 爆发期）+ 没清创的伤口数与每晚代价', () => {
    expect(infectionLine(10, mk())).toContain('潜伏');
    expect(infectionLine(40, mk())).toContain('警戒');
    const burst = infectionLine(70, mk([infected('armR'), infected('legL')]));
    expect(burst).toContain('爆发期');
    expect(burst).toContain('2 处伤口没清创（每晚 +8）');
    expect(infectionLine(0, null)).toContain('0%');
  });
});
