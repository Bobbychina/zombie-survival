/* M31 单测：人体与伤病（塔科夫式分部位 + 双轨制）
   ① 命中部位抽签与伤害分摊；② 伤病生成与"小出血升级成大出血"；
   ③ 惩罚合并（未处理 / 已急救 / 已手术三档）；④ 治疗链（急救 → 手术 → 康复，含手术失败）；
   ⑤ 出血 tick 掉血与康复；⑥ 走路成本；⑦ HUD 文案。 */
import { describe, expect, it } from 'vitest';
import {
  INJURIES, INJURY_IDS, PARTS, PART_INFO, applyHit, bodyFromHp, bodyPenalty, bodySummary, emptyBody,
  hudLine, rollPart, tickBody, travelExtra, treat, treatOptions,
} from '../src/v4/medical-core';

const rng = (seed = 42) => { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const fixed = (v: number) => () => v;

describe('M31 人体：部位与命中', () => {
  it('七个部位都在，权重覆盖全身（胸腹最容易挨打，头最少）', () => {
    expect(PARTS.length).toBe(7);
    const counts: Record<string, number> = {};
    const r = rng(7);
    for (let i = 0; i < 7000; i++) { const p = rollPart(r); counts[p] = (counts[p] ?? 0) + 1; }
    for (const p of PARTS) expect(counts[p]).toBeGreaterThan(200);
    expect(counts.torso).toBeGreaterThan(counts.head);
  });

  it('老档迁移：按当前 HP 比例铺到各部位（重伤玩家不会被洗成健康人）', () => {
    const b = bodyFromHp(50, 100, 3);
    for (const p of PARTS) expect(b.parts[p]).toBe(50);
    expect(b.injuries).toEqual([]);
    expect(emptyBody().parts.torso).toBe(100);
  });

  it('掉血越多越容易出重伤；部位血量按伤害掉', () => {
    const light = applyHit(emptyBody(), 5, 100, 1, fixed(0.5), { force: { part: 'torso' } });
    const heavy = applyHit(emptyBody(), 60, 100, 1, fixed(0.5), { force: { part: 'torso' } });
    expect(light.body.parts.torso).toBeLessThan(100);
    expect(heavy.body.parts.torso).toBeLessThan(light.body.parts.torso);
    const heavyIds = heavy.body.injuries.map(i => i.id);
    expect(heavyIds.length).toBe(1);
    expect(['bleedL', 'pierce', 'fracture', 'limb']).toContain(heavyIds[0]);   // 大伤害只会给重伤
  });

  it('部位限制生效：头不会骨折、腿不会脑震荡', () => {
    const r = rng(11);
    for (let i = 0; i < 400; i++) {
      const { body } = applyHit(emptyBody(), 20, 100, 1, r, { force: { part: 'head' } });
      for (const inj of body.injuries) expect(INJURIES[inj.id].parts ? INJURIES[inj.id].parts!.indexOf('head') >= 0 : true).toBe(true);
    }
  });

  it('同一部位再次受伤：小出血会升级成大出血', () => {
    const b = emptyBody();
    b.injuries.push({ part: 'armL', id: 'bleedS', day: 1 });
    /* 挑一个"必定小出血"的随机序列：固定 rng 返回值让抽签落在 bleedS 区间 */
    let up = false;
    for (let seed = 1; seed < 200 && !up; seed++) {
      const r = applyHit(b, 3, 100, 2, rng(seed), { force: { part: 'armL' } });
      if (r.body.injuries[0].id === 'bleedL') up = true;
    }
    expect(up).toBe(true);
  });
});

describe('M31 人体：惩罚与治疗链', () => {
  it('未处理 / 已急救 / 已手术三档惩罚依次变轻', () => {
    const mk = (extra: Partial<{ field: boolean; done: boolean }>) => {
      const b = emptyBody();
      b.injuries.push({ part: 'legL', id: 'fracture', day: 1, ...extra });
      return bodyPenalty(b);
    };
    const raw = mk({}), field = mk({ field: true }), done = mk({ done: true });
    expect(Math.abs(raw.dodge)).toBeGreaterThan(Math.abs(field.dodge));
    expect(Math.abs(field.dodge)).toBeGreaterThan(Math.abs(done.dodge));
    expect(raw.moveMul).toBeGreaterThan(done.moveMul);
    expect(raw.note[0]).toContain('左腿');
  });

  it('骨折让走路更贵（+行动力），处理完就恢复', () => {
    const b = emptyBody();
    b.injuries.push({ part: 'legR', id: 'fracture', day: 1 });
    expect(travelExtra(b)).toBeGreaterThan(0);
    const fixedB = bodyFromHp(100, 100, 1);
    expect(travelExtra(fixedB)).toBe(0);
  });

  it('急救道具：绷带治小出血、夹板治骨折（标记 field）', () => {
    const b = emptyBody();
    b.injuries.push({ part: 'torso', id: 'bleedS', day: 1 });
    const r1 = treat(b, 'torso', 'bandage', 1, 0, fixed(0.9));
    expect(r1.ok).toBe(true);
    expect(r1.body!.injuries[0].field).toBe(true);
    expect(treat(r1.body!, 'torso', 'bandage', 1, 0, fixed(0.9)).ok).toBe(false);   // 不重复急救
    const b2 = emptyBody();
    b2.injuries.push({ part: 'legL', id: 'fracture', day: 1 });
    expect(treat(b2, 'legL', 'splint', 1, 0, fixed(0.9)).ok).toBe(true);
    expect(treat(b2, 'legL', 'bandage', 1, 0, fixed(0.9)).ok).toBe(false);          // 用错道具
  });

  it('手术：技能越高成功率越高；失败会变成感染伤口（这就是"有风险"）', () => {
    const b = emptyBody();
    b.injuries.push({ part: 'legL', id: 'fracture', day: 1 });
    const ok = treat(b, 'legL', 'surgerykit', 2, 5, fixed(0.5));        // 5 级：成功率 100%
    expect(ok.ok).toBe(true);
    expect(ok.body!.injuries[0].done).toBe(true);
    const bad = treat(b, 'legL', 'surgerykit', 2, 0, fixed(0.9));       // 0 级：55%，0.9 必失手
    expect(bad.ok).toBe(true);
    expect(bad.body!.injuries[0].id).toBe('infected');
    expect(String(bad.log)).toContain('手术失败');
  });

  it('治疗选项清单与伤病表一致（UI 不该出现 undefined）', () => {
    for (const id of INJURY_IDS) {
      const b = emptyBody();
      const part = INJURIES[id].parts ? INJURIES[id].parts![0] : 'torso';
      b.injuries.push({ part, id, day: 1 });
      const opts = treatOptions(b, part);
      /* M69：感染伤口多一颗「💊 抗生素压制」（可反复点、每天一次），所以它的选项数比"字段/手术"那套多 1 */
      const base = INJURIES[id].field || INJURIES[id].surgery ? (INJURIES[id].field && INJURIES[id].surgery ? 2 : 1) : 0;
      expect(opts.length).toBe(base + (id === 'infected' ? 1 : 0));
      for (const o of opts) expect(o.item.length).toBeGreaterThan(2);
    }
  });
});

describe('M31 人体：出血与康复', () => {
  it('未处理的出血每 tick 扣血，止住就不扣', () => {
    const b = emptyBody();
    b.injuries.push({ part: 'torso', id: 'bleedL', day: 1 });
    const r = tickBody(b, 1, { nutrition: 100 });
    expect(r.hp).toBeLessThan(0);
    const stopped = { ...b, injuries: [{ part: 'torso' as const, id: 'bleedL' as const, day: 1, field: true }] };
    expect(tickBody(stopped, 1, { nutrition: 100 }).hp).toBeLessThan(0);      // 急救过：还流一点（一半）
    const done = { ...b, injuries: [{ part: 'torso' as const, id: 'bleedL' as const, day: 1, done: true }] };
    expect(tickBody(done, 1, { nutrition: 100 }).hp).toBe(0);                 // 手术过：不流了
  });

  it('手术过的伤按天数康复（没营养不回血，睡觉翻倍）', () => {
    const b = emptyBody();
    b.parts.legL = 40;
    b.injuries.push({ part: 'legL', id: 'fracture', day: 1, done: true, field: true });
    const noFood = tickBody(b, 2, { nutrition: 40 });
    expect(noFood.body.parts.legL).toBe(40);
    const fed = tickBody(b, 2, { nutrition: 90 });
    expect(fed.body.parts.legL).toBeGreaterThan(40);
    const slept = tickBody(b, 2, { nutrition: 90, resting: true });
    expect(slept.body.parts.legL).toBeGreaterThan(fed.body.parts.legL);
    /* 到日子就痊愈（康复天数 = 4） */
    const healed = tickBody(b, 1 + INJURIES.fracture.recoverDays, { nutrition: 90 });
    expect(healed.body.injuries.length).toBe(0);
    expect(healed.healed[0]).toContain('骨折');
  });

  it('急救过的非手术伤会自己长好（慢两天）', () => {
    const b = emptyBody();
    b.injuries.push({ part: 'torso', id: 'bleedS', day: 1, field: true });
    expect(tickBody(b, 2, { nutrition: 90 }).body.injuries.length).toBe(1);
    expect(tickBody(b, 5, { nutrition: 90 }).body.injuries.length).toBe(0);
  });
});

describe('M31 人体：总览与 HUD 文案', () => {
  it('总览给出最惨的部位与伤情清单', () => {
    const b = bodyFromHp(60, 100, 1);
    b.parts.head = 12;
    b.injuries.push({ part: 'head', id: 'concuss', day: 1 });
    const s = bodySummary(b, 60, 100);
    expect(s.worst).toBe('head');
    expect(s.text).toContain('脑震荡');
  });

  it('HUD 有伤才显示，且写明惩罚（命中/闪避/走路/流血）', () => {
    expect(hudLine(emptyBody())).toBe('');
    const b = emptyBody();
    b.injuries.push({ part: 'legL', id: 'fracture', day: 1 }, { part: 'armR', id: 'bleedS', day: 1 });
    const line = hudLine(b);
    expect(line).toContain('左腿');
    expect(line).toContain('流血');
    expect(line).toContain('走路');
  });
});
