/* C02 不变量断言：任何一条 FAIL 都说明状态被写坏了。返回 PASS/FAIL JSON。 */
(function(){
  const fails = [];
  const n = { steps:0 };
  const ok = (cond, msg) => { if(!cond) fails.push(msg); };
  function check(tag){
    ok(S.hp >= 0 && S.hp <= S.hpMax, tag + ': hp 越界 ' + S.hp + '/' + S.hpMax);
    ok(S.sta >= 0 && S.sta <= S.staMax, tag + ': 体力越界 ' + S.sta + '/' + S.staMax);
    ok(S.ap >= 0 && S.ap <= S.apMax, tag + ': 行动力越界');
    ok(S.hun >= 0 && S.hun <= 100 && S.thi >= 0 && S.thi <= 100, tag + ': 饥饿/水分越界');
    ok(S.infect >= 0 && S.infect <= 100, tag + ': 感染越界');
    ok(S.day >= 1, tag + ': 天数非法');
    ok(S.ammo >= 0 && S.mat >= 0, tag + ': 弹药/材料为负');
    ok(S.noise >= 0, tag + ': 噪音为负');
    for(const id in S.inv) ok(!!ITEMS[id], tag + ': 背包出现未知物品 ' + id);
    for(const id in S.store) ok(!!ITEMS[id], tag + ': 储物箱出现未知物品 ' + id);
    const used = Object.keys(S.store).reduce((a, k) => a + S.store[k], 0);
    ok(S.base.storage > 0 ? used <= S.base.storage * 12 : used === 0, tag + ': 储物箱超容 ' + used);
    for(const sl in S.eq) ok(!S.eq[sl] || !!ITEMS[S.eq[sl]], tag + ': 装备槽未知 id ' + S.eq[sl]);
    for(const k in S.skills) ok(S.skills[k] >= 0 && S.skills[k] <= 10, tag + ': 技能越界 ' + k);
    for(const k in S.base) ok(S.base[k] >= 0 && S.base[k] <= BASE_UP[k].max, tag + ': 据点等级越界 ' + k);
    ok(S.lore.every(x => LORE.some(l => l.id === x)), tag + ': 秘闻表有未知 id');
    ok(S.ach.every(x => ACHIEVEMENTS.some(a => a.id === x)), tag + ': 成就表有未知 id');
    ok(!S.comp || !!COMPANIONS[S.comp], tag + ': 同伴 id 未知');
    ok(S.compHp >= 0, tag + ': 同伴生命为负');
    ok(S.quest.stage >= 0 && S.quest.stage <= 6, tag + ': 主线阶段越界');
    for(const z in S.seen) ok(!!ZONES[z], tag + ': seen 出现未知区域 ' + z);
    ok(!S.over || S.hp <= 0, tag + ': over=true 但还有血');
    n.steps++;
  }
  function autoFight(limit){
    let g = 0;
    while(battle && g++ < (limit || 200)){
      if(S.hp < S.hpMax * .4) S.hp = S.hpMax;
      const w = ITEMS[S.eq.wpn] || ITEMS.crowbar;
      if(w.ammo && S.ammo >= w.ammo) combatAct('shoot');
      else if(S.sta >= (w.sta || 0)) combatAct('melee');
      else combatAct('guard');
      check('combat#' + g);
    }
    return g;
  }
  check('init');
  // 1) 搜刮 30 次（含战斗）
  for(let i = 0; i < 30; i++){
    if(S.over){ restart(); check('respawn#search' + i); }   // 死了就重开一局：不能给死人补血，那会造出"over 但满血"的假状态
    S.ap = S.apMax; if(S.hp < S.hpMax * .5) S.hp = S.hpMax;
    const ids = Object.keys(ZONES);
    searchZone(ids[i % ids.length], i % 3 === 0 ? 1 : 0);
    autoFight(); closeAllModals();
    check('search#' + i);
  }
  // 2) 连睡 10 天（含尸潮守夜战）
  for(let d = 0; d < 10; d++){
    if(S.over){ restart(); check('respawn#night' + d); }
    S.ap = S.apMax;
    sleepNight();
    autoFight();
    closeAllModals();
    check('night#' + d);
    if(S.over){ restart(); check('respawn'); }
  }
  // 3) 制作 / 建造 / 商店 / 用消耗品
  S.inv.cloth = 20; S.inv.chem = 20; S.inv.metal = 40; S.inv.wood = 40; S.inv.tape = 20; S.inv.chip = 12; S.inv.powder = 20; S.inv.bottle = 6; S.inv.fuel = 6; S.mat = 900;
  RECIPES.forEach((r, i) => { S.ap = S.apMax; craft(i); check('craft#' + i); });
  Object.keys(BASE_UP).forEach(k => { for(let i = 0; i < 3; i++){ S.ap = S.apMax; const c = scaledCost(k, S.base[k]); if(c) for(const m in c) S.inv[m] = (S.inv[m] || 0) + c[m] * 2; build(k); check('build#' + k); } });
  openMerchant(); buyMerchant(0); closeAllModals(); check('merchant');
  ['bandage','medkit','painkiller','anti'].forEach(id => { addItem(id, 2, true); S.hp = 30; S.infect = 70; useConsumable(id); check('use#' + id); });
  // 4) 最终决战 + 无尽
  S.quest.stage = 5; S.hp = 1e6; S.hpMax = 1e6; S.ammo = 1e5; S.sta = 1e6; S.staMax = 1e6; S.eq.wpn = 'crowbar';
  startFinalBattle(); autoFight(600); check('final');
  enterEndless(); check('endless');
  // 5) 存读档 + 坏档注入
  S.day = 33; saveGame(true); check('save');
  const baked = JSON.parse(localStorage.getItem('zombie_survival_save_v2'));
  ok(baked && baked.day === 33, '存档未写入主键');
  localStorage.setItem('zombie_survival_save_v2', '{坏掉的 JSON');
  const loaded = loadGame(true);
  ok(loaded === true, '坏档注入后未能回退到 .bak');
  ok(S.day >= 1, '回退后状态异常');
  check('badSaveDrill');
  // 6) 存档清洗
  const dirty = Object.assign({}, baked, { hp: 1e9, v: 2, inv: { crowbar: 1, 不存在的物品: 5 }, eq: { wpn: '不存在', body: 'kevlar' }, comp: '幽灵', lore: ['l_ok', 'l_不存在'] });
  const clean = sanitizeSave(dirty);
  ok(clean.hp <= clean.hpMax, 'sanitize 未夹住 hp');
  ok(!clean.inv['不存在的物品'], 'sanitize 未剔除未知物品');
  ok(clean.eq.wpn === 'crowbar', 'sanitize 未把非法武器打回默认');
  ok(clean.comp === null, 'sanitize 未剔除未知同伴');
  ok(clean.lore.every(x => LORE.some(l => l.id === x)), 'sanitize 未清洗秘闻表');
  check('sanitize');
  return JSON.stringify({ pass: fails.length === 0, steps: n.steps, fails: fails.slice(0, 25) });
})();
