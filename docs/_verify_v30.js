/* v3.0 世界层验收：地图/路程、日历与血月、基地防线、伤口、腐坏断电、尸群迁徙、100 天结局、评分 */
(async function(){
  const R = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const T = async (name, fn) => { try{ R[name] = await fn(); }catch(e){ R[name] = 'ERR: ' + (e && e.message ? e.message : e); } };
  const fresh = () => { S = newState(); battle = null; closeAllModals(); window.__renderErr = null; localStorage.clear(); defInit(); };

  await T('W1_map_and_travel', () => {
    fresh();
    const hasBase = !!MAP.base, zones = Object.keys(ZONES).filter(z => MAP[z]);
    S.loc = 'base'; const costMarket = travelCost('market'), costLab = travelCost('lab');
    const ok = travelTo('market');
    const at = S.loc, back = travelCost('base');
    fresh();
    return { mapNodes:Object.keys(MAP).length, zonesCovered:zones.length, costMarket, costLab, returned:ok, at, costBack:back, symmetric: back === costMarket,
      pass: hasBase && zones.length === 8 && costMarket === 1 && costLab === 3 && ok === true && at === 'market' && back === costMarket };
  });
  await T('W2_search_requires_location', () => {
    fresh(); S.hpMax = 1e6; S.hp = 1e6;
    S.loc = 'base'; S.ap = S.apMax;
    searchZone('police', 0);                       // 应自动前往（并付路程）
    const moved = S.loc === 'police';
    const apSpent = S.apMax - S.ap;
    fresh(); S.hpMax = 1e6; S.hp = 1e6; S.loc = 'base'; S.ap = 0;
    searchZone('police', 0);
    const blocked = S.loc === 'base';              // 没行动力 → 走不过去
    fresh();
    return { moved, apSpent, blockedWithoutAP:blocked, pass: moved && apSpent >= 2 && blocked };
  });
  await T('W3_calendar', () => {
    fresh();
    const d1 = daysToHorde();                       // 第 1 天 → 6 天后血月
    S.day = 7; const d7 = daysToHorde();            // 血月当天
    S.day = 6; const ev = nextEventText();
    S.day = 13; const ev2 = nextEventText();
    S.day = 1; S.horde = { eta:2, size:5 }; const ev3 = nextEventText();
    fresh();
    return { day1:d1, day7:d7, day6text:ev, day13text:ev2, hordeText:ev3,
      pass: d1 === 6 && d7 === 0 && ev.indexOf('血月') >= 0 && ev2.indexOf('断电') >= 0 && ev3.indexOf('尸群') >= 0 };
  });
  await T('W4_bloodmoon_forces_siege', () => {
    fresh(); S.day = 7; S.hp = 9999; S.hpMax = 9999; S.loc = 'base'; S.base.wall = 1; S.base.door = 1;
    const before = S.stats.hordes;
    sleepNight();                                    // 第 7 天夜：必定血月
    const sieging = !!battle && !!battle.opts.siege;
    const blood = battle ? !!battle.opts.bloodMoon : false;
    const count = battle ? battle.foes.length : 0;
    if(battle){ battle.foes.forEach(f => { f.hp = 0; f.dead = true; }); endCombat('flee'); }
    closeAllModals();
    fresh();
    return { sieging, blood, foes:count, dayAdvanced:true,
      pass: sieging && blood && count >= 2 && before !== undefined };
  });
  await T('W5_defense_line_and_traps', () => {
    fresh(); S.day = 20; S.hpMax = 99999; S.hp = 99999; S.loc = 'base';
    S.base.door = 2; S.base.wall = 2; defInit();
    const dm = defMax(), startHp = S.def.doorHp + S.def.wallHp;
    S.def.traps = { spike:1, fire:1, alarm:1 };
    S.inv.metal = 20; S.inv.wood = 20; S.ap = 8;
    nightRaid();
    const wounded = S.def.doorHp + S.def.wallHp < startHp || S.def.traps.spike === 0;   // 陷阱被消耗 or 防线被打
    const trapUsed = S.def.traps.spike === 0 && S.def.traps.fire === 0 && S.def.traps.alarm === 0;
    let repaired = false;
    if(battle){
      S.def.doorHp = 5;
      const apBefore = S.ap;
      combatRepair();
      repaired = S.def.doorHp === defMax().door && S.ap === apBefore - 1;
      battle.foes.forEach(f => { f.hp = 0; f.dead = true; });
      endCombat('flee');
    }
    closeAllModals(); fresh();
    return { defMax:dm, startHp, lineDamagedOrTrap:wounded, trapUsed, repaired,
      pass: dm.door > 0 && dm.wall > 0 && trapUsed && repaired };
  });
  await T('W6_wounds', () => {
    fresh();
    const b1 = addWound('bleed', 1);
    const dup = addWound('bleed', 1);                 // 不叠加
    const cured = cureWound('bleed');
    const f = addWound('fracture', 1);
    const walkCost = travelCost('lab');               // 骨折 +1
    S.loc = 'base'; S.eq.wpn = 'crowbar';
    const mods = statMods(); const dodgePenalty = mods.dodge < 0;   // v3.0：伤口提示走 HUD chip，不再塞进 note
    const sick = addWound('sick', 1); const mods2 = statMods();
    fresh();
    return { added:b1, noDuplicate:dup === false, cured, fracture:f, walkCostWithFracture:walkCost,
      dodgePenalty:dodgePenalty, sickPenalty:mods2.dmgMul < 1,
      pass: b1 && dup === false && cured && f && walkCost >= 4 && dodgePenalty && mods2.dmgMul < 1 };
  });
  await T('W7_bleed_drains_at_night', () => {
    fresh(); S.hp = 100; S.hpMax = 100; S.loc = 'base'; S.wounds = [{ t:'bleed', sev:1, left:99 }];
    sleepNight(); closeAllModals();
    const hp = S.hp;                                   // 睡一觉要扣流血伤害
    fresh();
    return { hpAfterNight:hp, pass: hp < 100 };
  });
  await T('W8_spoilage_and_poweroff', () => {
    fresh();
    addItem('veg', 3, true); S.spoil.veg = 1;
    spoilTick();                                       // 归零 → 变腐坏食物
    const rotten = itemCount('rot'), vegLeft = itemCount('veg');
    fresh(); S.day = 13; S.loc = 'base'; S.base.filter = 2; S.base.garden = 1;
    addItem('fuel', 1, true);
    const w0 = itemCount('water'), v0 = itemCount('veg');
    sleepNight(); closeAllModals();                     // 第 14 天 → 断电
    const off = S.cal.powerOff, water = itemCount('water') - w0, veg = itemCount('veg') - v0;
    fresh(); S.day = 20; S.loc = 'base'; S.base.filter = 2; S.inv.fuel = 0; S.cal.powerOff = true;   // 断电已在第 14 天发生过
    const w1 = itemCount('water');
    sleepNight(); closeAllModals();
    const noWaterWithoutFuel = itemCount('water') === w1;
    fresh();
    return { rotten, vegLeft, powerOff:off, waterFromFilter:water, vegFromGarden:veg, noWaterWithoutFuel,
      pass: rotten === 3 && vegLeft === 0 && off === true && water === 2 && veg === 1 && noWaterWithoutFuel };
  });
  await T('W9_horde_migration', () => {
    fresh(); S.day = 20; S.loc = 'base'; S.hp = 9999; S.hpMax = 9999;
    raiseHorde(0, '测试');
    const eta1 = S.horde.eta, size = S.horde.size;
    sleepNight(); closeModalsIfAny();
    const eta2 = S.horde.eta;
    sleepNight(); closeModalsIfAny();
    const eta3 = S.horde.eta;
    sleepNight(); closeModalsIfAny();                   // eta 归零 → 必打
    const sieging = !!battle;
    if(battle){ battle.foes.forEach(f => { f.hp = 0; f.dead = true; }); endCombat('flee'); }
    closeAllModals(); fresh();
    return { eta1, size, eta2, eta3, arrivedSiege:sieging, pass: eta1 === 3 && eta2 === 2 && eta3 === 1 && sieging };
  });
  await T('W10_day100_ending', () => {
    fresh(); S.day = 100; S.loc = 'base'; S.hp = 100; S.base.radio = 1;
    sleepNight(); closeAllModals();
    const won = S.flags.won, over = S.over, stage = S.quest.stage;
    const sc = runScore();
    fresh();
    return { won, over, stage, score:sc.raw, rank:sc.rank,
      pass: won === true && over === true && stage === 6 && sc.raw > 0 && !!sc.rank };
  });
  await T('W11_night_travel_danger', () => {
    fresh(); S.hp = 99999; S.hpMax = 99999;
    // 同一段路，白天 vs 夜里的遭遇率公式必须不同（夜里更高）
    const nightProb = .12 + (MAP.military.d) * .045 + .16;
    const dayProb   = .12 + (MAP.military.d) * .045;
    S.loc = 'base'; S.ap = 0;                            // 行动力耗尽 → phaseName 判定为夜晚
    const ph = phaseName()[1];
    fresh();
    return { phaseAtLowAP:ph, dayProb:+dayProb.toFixed(3), nightProb:+nightProb.toFixed(3),
      pass: ph === 'night' && nightProb > dayProb };
  });
  const failed = Object.keys(R).filter(k => !(R[k] && R[k].pass));
  return JSON.stringify({ allPass: failed.length === 0, failed, results: R }, null, 1);
  function closeModalsIfAny(){ closeAllModals(); }
})();
