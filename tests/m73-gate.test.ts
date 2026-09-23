/* M73 技能硬门槛 + 死亡扣进度：只盯需求原文里的三句硬话 ——
 *   ① 高级武器/防具**要**战斗技能等级（不够 = 装不上，但东西不丢、永远有低阶替代）；
 *   ② 军事管制区/实验室要搜刮技能等级，**不够则效率腰斩而不是完全进不去**（产出下限 1 份）；
 *   ③ 死亡**清空当前等级进度条**，等级保留。
 * 纯逻辑在 src/v4/gate-core.ts；legacy（equipWeapon/searchZone/lootItem/gameOver）与
 * v4（searchPoi）都读同一套函数 —— 这里测的就是它们共用的那份判定。 */
import { describe, expect, it } from 'vitest';
import {
  EQUIP_GATE, GATE_SKILL_NAME, ZONE_GATES, ZONE_GATE_MUL, deathXpLine, equipGate, gateYield, wipeLevelXp,
  zoneGate, zoneGateNote,
} from '../src/v4/gate-core';

const ITEMS = {
  crowbar: { n: '撬棍', t: 'wpn', dmg: 14, sta: 7 },
  machete: { n: '砍刀', t: 'wpn', dmg: 23, sta: 9 },
  axe: { n: '消防斧', t: 'wpn', dmg: 34, sta: 16 },
  pistol: { n: '手枪', t: 'wpn', dmg: 21, ammo: 1 },
  rifle: { n: '突击步枪', t: 'wpn', dmg: 26, ammo: 1 },
  shotgun: { n: '霰弹枪', t: 'wpn', dmg: 46, ammo: 3 },
  marksman: { n: '精准步枪', t: 'wpn', dmg: 64, ammo: 3 },
  hk_m14: { n: '霍克的 M14', t: 'wpn', dmg: 58, ammo: 3 },
  vest: { n: '战术背心', t: 'gear', slot: 'body', armor: 2 },
  kevlar: { n: '防弹衣', t: 'gear', slot: 'body', armor: 5 },
  hazmat: { n: '防化服', t: 'gear', slot: 'body', dmgCut: 0.4, radProt: 0.6 },
  boots: { n: '军靴', t: 'gear', slot: 'feet', dodge: 0.08 },
  medkit: { n: '急救包', t: 'med' },
} as any;

describe('M73 ① 高级武器/防具的技能门槛', () => {
  it('低阶武器不吃门槛（撬棍/砍刀/手枪/突击步枪：新手开局就能用）', () => {
    for (const id of ['crowbar', 'machete', 'pistol', 'rifle', 'vest', 'boots', 'medkit']) {
      const g = equipGate(ITEMS[id], {});
      expect(g.ok, id).toBe(true);
      expect(g.tier, id).toBe('');
    }
  });

  it('重近战吃「近战」Lv.3：消防斧 34 伤害刚好卡在阈值上', () => {
    expect(EQUIP_GATE.MELEE_T1_DMG).toBe(34);
    expect(equipGate(ITEMS.axe, { melee: 2 }).ok).toBe(false);
    expect(equipGate(ITEMS.axe, { melee: 2 }).need).toBe(3);
    expect(equipGate(ITEMS.axe, { melee: 3 }).ok).toBe(true);
    expect(equipGate(ITEMS.axe, { melee: 3 }).skill).toBe('melee');
  });

  it('枪分两档：霰弹枪（46）要射击 Lv.3，精准步枪/M14（64/58）要 Lv.5', () => {
    expect(equipGate(ITEMS.shotgun, { shoot: 2 }).ok).toBe(false);
    expect(equipGate(ITEMS.shotgun, { shoot: 2 }).need).toBe(3);
    expect(equipGate(ITEMS.shotgun, { shoot: 3 }).ok).toBe(true);
    expect(equipGate(ITEMS.marksman, { shoot: 4 }).ok).toBe(false);
    expect(equipGate(ITEMS.marksman, { shoot: 4 }).need).toBe(5);
    expect(equipGate(ITEMS.marksman, { shoot: 5 }).ok).toBe(true);
    expect(equipGate(ITEMS.hk_m14, { shoot: 5 }).ok).toBe(true);
    expect(equipGate(ITEMS.hk_m14, { shoot: 5 }).tier).toBe('枪械');
  });

  it('重甲要体能：防弹衣（护甲 5）与防化服（减伤 40%）都算，战术背心/军靴不算', () => {
    expect(equipGate(ITEMS.kevlar, { fitness: 2 }).ok).toBe(false);
    expect(equipGate(ITEMS.kevlar, { fitness: 3 }).ok).toBe(true);
    expect(equipGate(ITEMS.hazmat, { fitness: 2 }).need).toBe(3);
    expect(equipGate(ITEMS.hazmat, { fitness: 3 }).tier).toBe('重甲');
    expect(equipGate(ITEMS.vest, {}).ok).toBe(true);
  });

  it('拦下来时必须给出人话理由（技能名 + 需要等级 + 现在等级 + 出路）', () => {
    const g = equipGate(ITEMS.marksman, { shoot: 1 });
    expect(g.why).toContain(GATE_SKILL_NAME.shoot);   // 射击
    expect(g.why).toContain('Lv.5');                  // 需要几级
    expect(g.why).toContain('Lv.1');                  // 现在几级
    expect(g.why).toContain('先拿低一档的用');          // 永远有路走
    expect(equipGate(null, {}).ok).toBe(true);        // 没物品不炸
  });

  it('技能等级取整、负值/未定义都当 0（存档脏数据不能让人白嫖门槛）', () => {
    expect(equipGate(ITEMS.marksman, { shoot: 4.9 }).ok).toBe(false);
    expect(equipGate(ITEMS.marksman, { shoot: -3 }).lv).toBe(0);
    expect(equipGate(ITEMS.marksman, undefined).ok).toBe(false);
    expect(equipGate(ITEMS.axe, { melee: 3.7 }).ok).toBe(true);
  });
});

describe('M73 ② 军事管制区 / 实验室的搜刮门槛（腰斩但不锁死）', () => {
  it('两个区分别卡生存 Lv.3 / Lv.5，其它区不吃门槛', () => {
    expect(ZONE_GATES.military.need).toBe(3);
    expect(ZONE_GATES.lab.need).toBe(5);
    expect(zoneGate('military', { survival: 2 }).gated).toBe(true);
    expect(zoneGate('military', { survival: 3 }).gated).toBe(false);
    expect(zoneGate('lab', { survival: 4 }).gated).toBe(true);
    expect(zoneGate('lab', { survival: 5 }).gated).toBe(false);
    for (const z of ['pharmacy', 'school', 'police', 'farm', undefined, '']) {
      const g = zoneGate(z as any, { survival: 0 });
      expect(g.gated, String(z)).toBe(false);
      expect(g.mul).toBe(1);
    }
  });

  it('不够级 = 效率 ×0.5（常量锁死，别偷偷改成锁死或只扣一点）', () => {
    expect(ZONE_GATE_MUL).toBe(0.5);
    expect(zoneGate('lab', { survival: 1 }).mul).toBe(0.5);
    expect(zoneGate('military', { survival: 0 }).mul).toBe(0.5);
  });

  it('产出打折但**下限 1**：门槛只降效率，绝不出现"搜了半天什么都没有"', () => {
    expect(gateYield(8, 0.5)).toBe(4);
    expect(gateYield(9, 0.5)).toBe(5);        // 四舍五入
    expect(gateYield(1, 0.5)).toBe(1);        // 下限
    expect(gateYield(0, 0.5)).toBe(1);        // 空产出也至少 1
    expect(gateYield(7, 1)).toBe(7);          // 达标不打折
  });

  it('提示文案只在被门槛卡住时出现，且写明 需要几级 / 现在几级 / 打几折', () => {
    const note = zoneGateNote(zoneGate('military', { survival: 1 }));
    expect(note).toContain('生存');
    expect(note).toContain('Lv.3');
    expect(note).toContain('Lv.1');
    expect(note).toContain('-50%');
    expect(note).toContain('至少留 1 份');
    expect(zoneGateNote(zoneGate('military', { survival: 3 }))).toBe('');
    expect(zoneGateNote(zoneGate('school', { survival: 0 }))).toBe('');
  });
});

describe('M73 ③ 死亡扣进度：清空当前等级进度条，等级保留', () => {
  it('所有技能的经验归零，丢的量和条数如实统计', () => {
    const { xp, lost, n } = wipeLevelXp({ shoot: 12, melee: 3, medic: 0, trade: 25 });
    expect(xp).toEqual({ shoot: 0, melee: 0, medic: 0, trade: 0 });
    expect(lost).toBe(40);
    expect(n).toBe(3);                        // medic 本来就是 0，不算"丢了一条"
  });

  it('等级不在这份逻辑里（读的是 S.skills，天然保留）——只清 xp', () => {
    const skills = { shoot: 4 };
    const { xp } = wipeLevelXp({ shoot: 30 });
    expect(skills).toEqual({ shoot: 4 });     // 调用方不许动 skills
    expect(xp.shoot).toBe(0);
  });

  it('脏数据安全：负数/小数/空表都不炸', () => {
    expect(wipeLevelXp(undefined).lost).toBe(0);
    expect(wipeLevelXp({ shoot: -5 }).lost).toBe(0);
    expect(wipeLevelXp({ shoot: 7.9 }).lost).toBe(7);
  });

  it('结算文案两种口径都说人话（有损失 / 本来就没进度）', () => {
    expect(deathXpLine(40, 3)).toContain('40');
    expect(deathXpLine(40, 3)).toContain('等级保留');
    expect(deathXpLine(0, 0)).toContain('等级都留着');
  });
});
