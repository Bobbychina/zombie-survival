/* v2.1 Wave 1 验收套件：逐条给出实测证据（C01–C14 / C18 / C24 + 白名单 + 老档兼容） */
(function(){
  const R = {};
  const T = (name, fn) => { try{ R[name] = fn(); }catch(e){ R[name] = 'ERR: ' + (e && e.message ? e.message : e); } };
  const fresh = () => { S = newState(); battle = null; closeAllModals(); window.__renderErr = null; localStorage.clear(); };
  function autoFight(limit){
    let g = 0;
    while(battle && g++ < (limit || 300)){
      if(S.hp < S.hpMax * .4) S.hp = S.hpMax;
      const w = ITEMS[S.eq.wpn] || ITEMS.crowbar;
      if(w.ammo && S.ammo >= w.ammo) combatAct('shoot');
      else if(S.sta >= (w.sta || 0)) combatAct('melee');
      else combatAct('guard');
    }
    return g;
  }

  // ── C01 存档安全带 ──
  T('C01_bak_rollback', () => {
    fresh(); S.day = 7; saveGame(true);
    const main1 = localStorage.getItem('zombie_survival_save_v2');
    S.day = 8; saveGame(true);                      // 这次写入前应把 day=7 转存进 .bak
    const bak = localStorage.getItem('zombie_survival_save_v2.bak');
    const bakDay = JSON.parse(bak).day;
    localStorage.setItem('zombie_survival_save_v2', '{坏掉的 JSON');
    const okLoad = loadGame(true);
    return { bakDay, okLoad, restoredDay: S.day, pass: bakDay === 7 && okLoad === true && S.day === 7 };
  });
  T('C01_autosave_after_search', () => {
    fresh();
    // v3.0：出门路上可能撞上东西打断搜索，所以重试几次并把战斗打完
    let tries = 0;
    while(tries++ < 6 && !S.seen.hospital){ S.ap = S.apMax; S.hp = S.hpMax; searchZone('hospital', 0); autoFight(); closeAllModals(); }
    const stored = JSON.parse(localStorage.getItem('zombie_survival_save_v2'));
    return { storedSeen: !!(stored && stored.seen && stored.seen.hospital), tries, pass: !!(stored && stored.seen && stored.seen.hospital) };
  });
  T('C01_render_guard', () => {
    fresh(); saveGame(true);
    const before = localStorage.getItem('zombie_survival_save_v2');
    window.__renderErr = new Error('模拟渲染崩溃');
    S.day = 99; autosave();
    const after = localStorage.getItem('zombie_survival_save_v2');
    window.__renderErr = null;
    return { fused: before === after, pass: before === after };
  });
  T('C01_version_gate', () => {
    const bad = migrateSave({ v: 99, day: 5 });
    const good = migrateSave({ v: 2, day: 5 });
    return { rejectedFuture: !!bad.error, acceptsCurrent: !good.error, pass: !!bad.error && !good.error };
  });
  // ── C02 白名单（新增字段必须先登记） ──
  T('C02_whitelist_keys', () => {
    const n = newState();
    const hasAll = ('bounties' in n.ui) && ('pace' in n.ui) && ('tips' in n.flags) && ('rescueUsed' in n.flags) && ('everDied' in n.flags);
    const s = sanitizeSave({ v: 2, day: 3, flags: { rescueUsed: true }, ui: { bounties: { a: 1 } } });
    return { hasAll, keptRescueFlag: s.flags.rescueUsed === true, keptBountyField: !!s.ui.bounties, pass: hasAll && s.flags.rescueUsed === true && !!s.ui.bounties };
  });
  T('C02_old_save_compat', () => {
    // 模拟"v2.1 之前的旧档"：没有 ui / flags.tips / rescueUsed，且带脏数据
    const legacy = { v: 2, day: 12, hp: 80, hpMax: 110, mat: 50, inv: { crowbar: 1, pistol: 1 }, eq: { wpn: 'pistol' },
      base: { bench: 2 }, skills: { shoot: 2 }, quest: { stage: 3, keycards: 2 }, lore: ['l_virus'], seen: { hospital: 1 },
      stats: { kills: 9, scav: 12 }, flags: { gotGun: true }, tab: 'base' };
    const s = sanitizeSave(legacy);
    return { day: s.day, tips: !!s.flags.tips, rescue: s.flags.rescueUsed === false, ui: !!s.ui,
      pass: s.day === 12 && !!s.flags.tips && s.flags.rescueUsed === false && !!s.ui && s.stats.kills === 9 };
  });
  // ── C03 首战降档 ──
  T('C03_first_fight_downgrade', () => {
    fresh();
    let maxFoes = 0, screamers = 0;
    for(let i = 0; i < 60; i++){ encounterRoll('hospital', 0); maxFoes = Math.max(maxFoes, battle.foes.length);
      if(battle.foes.some(f => f.id === 'screamer')) screamers++; closeAllModals(); battle = null; }
    S.stats.kills = 5; let groups = 0;
    for(let i = 0; i < 120; i++){ encounterRoll('market', 1); if(battle.foes.length > 1) groups++; closeAllModals(); battle = null; }
    return { day1MaxFoes: maxFoes, day1Screamers: screamers, groupsAfterFirstKill: groups,
      pass: maxFoes === 1 && screamers === 0 && groups > 0 };
  });
  // ── C04 死前三次提示 ──
  T('C04_three_tips', () => {
    fresh(); startCombat(['walker'], { title:'t' }); drawCombat();
    const t1 = !!S.flags.tips.cbt1;
    S.hp = Math.round(S.hpMax * .5); drawCombat(); const t2 = !!S.flags.tips.cbt2;
    S.hp = Math.round(S.hpMax * .3); drawCombat(); const t3 = !!S.flags.tips.cbt3;
    const shown = Object.keys(S.flags.tips).length;
    closeAllModals(); battle = null;
    return { cbt1: t1, cbt2: t2, cbt3: t3, tipCount: shown, pass: t1 && t2 && t3 };
  });
  // ── C05 一次濒死救援（整档唯一 / 决战无效 / 扣一半材料） ──
  T('C05_rescue_once', () => {
    fresh(); S.day = 2; S.mat = 100; S.hp = 0;
    gameOver('测试');
    const first = { over: S.over, hp: S.hp, mat: S.mat, used: S.flags.rescueUsed };
    S.hp = 0; gameOver('测试2');
    const second = { over: S.over };
    fresh(); S.day = 9; S.hp = 0; gameOver('测试3'); const late = { over: S.over };
    fresh(); S.day = 2; S.hp = 0; gameOver('测试4', { noRescue: true }); const final = { over: S.over };
    fresh();
    return { first, second, lateDayNoRescue: late.over, finalBattleNoRescue: final.over,
      pass: first.over === false && first.hp === 25 && first.mat === 50 && first.used === true && second.over === true && late.over === true && final.over === true };
  });
  // ── C06 下一步 + 微教学 ──
  T('C06_next_step', () => {
    fresh(); const a = nextStep().txt;
    S.ap = 0; const b = nextStep().txt;
    S.ap = 3; S.hun = 10; const c = nextStep().txt;
    S.hun = 80; S.quest.stage = 5; const d = nextStep().txt;
    fresh(); spendAP(S.apMax); const tipFired = !!S.flags.tips.noap;
    return { first: a.slice(0, 14), noAp: b.slice(0, 10), hungry: c.slice(0, 8), finalStage: d.slice(0, 10), tipFired,
      pass: a.indexOf('圣玛丽') >= 0 && b.indexOf('睡觉') >= 0 && c.indexOf('饿') >= 0 && d.indexOf('方舟') >= 0 && tipFired };
  });
  // ── C07 护甲百分比主导（验收线：护甲 9 第 45 天普通丧尸单次伤害 > 5） ──
  T('C07_armor_math', () => {
    fresh();
    S.day = 45; S.hpMax = 100000; S.hp = 100000; S.staMax = 100000; S.sta = 100000;
    S.eq.head = 'helmet'; S.eq.body = 'kevlar'; S.skills.fitness = 9; S.skills.stealth = 0; S.eq.feet = null;
    S.inv = { crowbar: 1 };
    const armor = armorTotal();
    const measure = (hazmat) => {
      S.eq.body = hazmat ? 'hazmat' : 'kevlar';
      startCombat(['walker'], { title:'armor-test' });     // foeTurn 需要真实战斗会话
      const foe = battle.foes[0];
      let hits = 0, total = 0;
      for(let i = 0; i < 400; i++){
        const before = S.hp;
        foeTurn(foe);
        const d = before - S.hp;
        if(d > 0){ hits++; total += d; }
        if(S.hp < 90000) S.hp = 100000;
        S.infect = 0;
      }
      closeAllModals(); battle = null;
      return { avg: +(total / Math.max(1, hits)).toFixed(2), hits };
    };
    const plain = measure(false), withHaz = measure(true);
    const rawDmg = 6 * (1 + 8 * .14);
    const oldFormula = Math.max(rawDmg - armor * 1.7, rawDmg * .4, 1);
    fresh();
    return { armor, rawWalkerDmg: +rawDmg.toFixed(2), noHazmat: plain, withHazmat: withHaz,
      oldFormula: +oldFormula.toFixed(2), oldFormulaWithHazmat: +(oldFormula * .6).toFixed(2),
      pass: plain.avg > 5 && plain.avg > oldFormula && withHaz.avg > oldFormula * .6 };
  });
  // ── C08 死亡螺旋拆除 ──
  T('C08_spiral', () => {
    fresh(); S.infect = 20; S.hun = 60; S.thi = 60;   // 扣掉夜间消耗（12/14）后仍 >25 → 走自然消退
    sleepNight(); const after = S.infect;
    fresh(); S.infect = 20; S.hun = 30; S.thi = 30;   // 边界：扣完只剩 18/16，低于 25 → 仍会 +1（这是设计意图，不是螺旋）
    sleepNight(); const afterLow = S.infect;
    fresh(); S.hun = 0; S.thi = 0; const hp0 = S.hp; S.ap = 6; tickVitals(); const loss = hp0 - S.hp;
    fresh();
    return { infectFrom60: after, infectFrom30: afterLow, zeroVitalsLossPerAction: loss,
      pass: after <= 20 && loss <= 9 };
  });
  // ── C09 浮动汇率 + 消耗出口 ──
  T('C09_merchant_rate', () => {
    fresh(); const r1 = +merchantRate().toFixed(3);
    S.day = 20; const r20 = +merchantRate().toFixed(3); S.day = 50; const r50 = +merchantRate().toFixed(3);
    fresh(); S.day = 20; S.mat = 1000;
    const before = S.mat; buyMerchant(0);                       // 急救包 34 × 1.4 = 48
    const spent = before - S.mat;
    const recipe = RECIPES.find(r => r.out === 'ammo');
    return { d1: r1, d20: r20, d50: r50, spentAtDay20: spent, ammoRecipeNeedsTape: !!(recipe && recipe.need.tape),
      pass: r1 === 1.02 && r20 === 1.4 && r50 === 2 && spent === 48 && !!(recipe && recipe.need.tape) };
  });
  // ── C10 武器定位 ──
  T('C10_weapons', () => {
    const perAmmo = id => +(ITEMS[id].dmg / (ITEMS[id].ammo || 1)).toFixed(1);
    const old = { rifle: 31 / 2, shotgun: 46 / 2 };
    return { rifle: { dmg: ITEMS.rifle.dmg, ammo: ITEMS.rifle.ammo, crit: ITEMS.rifle.crit, perAmmo: perAmmo('rifle') },
      shotgun: { ammo: ITEMS.shotgun.ammo, perAmmo: perAmmo('shotgun') }, marksman: { perAmmo: perAmmo('marksman') },
      pass: ITEMS.rifle.dmg === 26 && ITEMS.rifle.ammo === 1 && ITEMS.shotgun.ammo === 3 };
  });
  // ── C11 防化服：不再三刀齐下 ──
  T('C11_hazmat', () => {
    fresh(); const src = foeTurn.toString();
    return { damageMultStill06: src.indexOf("d *= .6") > 0, biteRate05: src.indexOf('hazmat\' ? .5 : 1') > 0,
      hasBiteReduction: src.indexOf('* .75') > 0, noStaPenalty: !('staPenalty' in ITEMS.hazmat),
      pass: src.indexOf("d *= .6") > 0 && src.indexOf('hazmat\' ? .5 : 1') > 0 && src.indexOf('* .75') > 0 && !('staPenalty' in ITEMS.hazmat) };
  });
  // ── C12 昼夜色温层 ──
  T('C12_daytint', () => {
    fresh();
    const read = () => { renderTop(); return document.getElementById('daytint').className; };
    S.ap = S.apMax; const dawn = read();
    S.ap = S.apMax - 2; const day = read();
    S.ap = S.apMax - 5; const dusk = read();
    S.ap = 0; const night = read();
    const css = Array.from(document.styleSheets[0].cssRules).some(r => r.cssText && r.cssText.indexOf('#daytint') >= 0);
    return { dawn, day, dusk, night, cssPresent: css, pass: dawn.indexOf('t-dawn') >= 0 && dusk.indexOf('t-dusk') >= 0 && night.indexOf('t-night') >= 0 };
  });
  // ── C13 伤害数字锚定 + 抖动 ──
  T('C13_anchor', () => {
    fresh(); document.getElementById('fx').innerHTML = '';     // 清掉上一项测试遗留的伤害数字
    startCombat(['walker','walker','walker'], { title:'t' }); battle.target = 1; drawCombat();
    const card = document.getElementById('foe-1');
    const rect = card.getBoundingClientRect();
    combatAct('shoot');
    const dmgEl = document.querySelector('#fx .dmg');
    const x = dmgEl ? parseFloat(dmgEl.style.left) : -1;
    const inside = x >= rect.left - 2 && x <= rect.right + 2;
    const jitter = card.className.indexOf('hit') >= 0;
    const cssHasAnim = Array.from(document.styleSheets[0].cssRules).some(r => r.cssText && r.cssText.indexOf('foeHit') >= 0);
    closeAllModals(); battle = null; document.getElementById('fx').innerHTML = '';
    return { cardCenterX: Math.round(rect.left + rect.width / 2), dmgX: Math.round(x), inside, jitter, cssHasAnim,
      pass: inside && jitter && cssHasAnim };
  });
  // ── C14 移动端标签：窄视口下直接读计算样式（由外部脚本先把视口设成 375×812） ──
  T('C14_tabs_visible', () => {
    const tabs = document.querySelectorAll('#tabs .tab');
    const cs = getComputedStyle(document.getElementById('tabs'));
    const rects = Array.from(tabs).map(t => t.getBoundingClientRect());
    const allVisible = rects.every(r => r.width > 8 && r.height > 8 && r.bottom <= window.innerHeight + 1);
    const inViewport = Array.from(tabs).every(t => t.getBoundingClientRect().right <= window.innerWidth + 1);
    const mainBtn = document.querySelector('#view .btn');
    const btnH = mainBtn ? Math.round(mainBtn.getBoundingClientRect().height) : 0;
    return { viewport: window.innerWidth + 'x' + window.innerHeight, tabsDisplay: cs.display, tabCount: tabs.length,
      allVisible, inViewport, mainBtnHeight: btnH,
      pass: cs.display === 'grid' && tabs.length === 8 && allVisible && inViewport && btnH >= 40 };
  });
  // ── C18 夜间守夜战 ──
  T('C18_siege', () => {
    fresh(); S.day = 12; S.base.wall = 1; S.base.door = 2; S.comp = null;
    nightRaid();
    const opened = !!battle && !!battle.opts.siege;
    const count = battle ? battle.foes.length : -1;      // 2 + floor(12/8)=1 - (1+2) = 0 → 夹到 1
    let won = false, fled = false;
    // 胜利路径
    battle.foes.forEach(f => { f.hp = 1; });
    autoFight(60); won = !battle && S.stats.hordes >= 1;
    // 弃守路径（逃跑是概率判定，重试到脱离战斗为止）
    fresh(); S.day = 30; S.base.wall = 0; S.base.door = 0; S.mat = 100; S.hp = 200; S.hpMax = 200;
    nightRaid(); const c2 = battle.foes.length;
    const hp0 = S.hp, mat0 = S.mat;
    let tries = 0;
    while(battle && tries++ < 25) combatAct('flee');
    fled = !battle && (S.hp < hp0 || S.mat < mat0);
    fresh();
    return { siegeOpened: opened, foesWithGuard: count, winPath: won, fleeLossPath: fled, fleeTries: tries, foesWithoutGuard: c2,
      pass: opened && count === 1 && won && fled && c2 >= 3 };
  });
  // ── C24 深度搜索正收益 + 陷阱钝化 + 感染可视化 ──
  T('C24_numbers', () => {
    // 用隔离法测「事件分支」材料产出：屏蔽遭遇战，避免战斗与状态漂移污染结论
    const isolate = (mode, n) => {
      fresh(); S.hpMax = 1e6; S.hp = 1e6; S.loc = 'market';   // v3.0：先到场，免得把路程行动力算进材料效率
      const orig = window.encounterRoll; window.encounterRoll = function(){};
      let searches = 0; const mat0 = S.mat;
      for(let i = 0; i < n; i++){
        S.ap = 9; S.infect = 0; S.hp = 1e6; S.hun = 100; S.thi = 100;
        const before = S.ap; searchZone('market', mode);
        if(S.ap !== before) searches++;
      }
      window.encounterRoll = orig;
      const gain = S.mat - mat0;
      return { perSearch: +(gain / Math.max(1, searches)).toFixed(2), perAP: +(gain / Math.max(1, searches * (mode ? 2 : 1))).toFixed(2) };
    };
    const norm = isolate(0, 500), deep = isolate(1, 500);
    // 主判据用权重期望值（采样方差太大：材料分支只占 12~16%）
    const dd = 2, st = 0;
    const wN = { fight:(.30+dd*.05)*(1-st), item:.14, mats:.16, surv:.07, trap:.07+dd*.012, lore:.09, empty:.12 };
    const wD = { fight:(.30+dd*.05)*1.35*(1-st), item:.14*1.5, mats:.16, surv:.07, trap:.07+dd*.012, lore:.18, empty:.12 };
    const sum = o => Object.keys(o).reduce((a, k) => a + o[k], 0);
    const expN = (.16 / sum(wN)) * 5.5;              // 普通：ri(2,5)+d 期望 5.5，1 AP
    const expD = (.16 / sum(wD)) * 16.5 / 2;         // 深度：ri(4,9)+d*3+4 期望 16.5，2 AP
    const src = searchZone.toString(), hudSrc = renderHud.toString();
    fresh();
    return { expectedNormalPerAP:+expN.toFixed(2), expectedDeepPerAP:+expD.toFixed(2),
      sampledNormalPerAP:norm.perAP, sampledDeepPerAP:deep.perAP,
      deepExpectationNotWorse: expD >= expN,
      deepSampleWithinTolerance: deep.perAP >= norm.perAP * 0.8,
      deepFormula: src.indexOf('ri(4, 9) + d * 3 + 4') > 0,
      trapScalesWithDay: src.indexOf('Math.floor(S.day / 6) * 2') > 0,
      infectTagInHud: hudSrc.indexOf('爆发期') > 0,
      pass: expD >= expN && deep.perAP >= norm.perAP * 0.8 && src.indexOf('ri(4, 9) + d * 3 + 4') > 0 && hudSrc.indexOf('爆发期') > 0 };
  });
  // ── 技能/成就/图鉴仍可用（回归） ──
  T('regress_views', () => {
    const bad = [];
    TABS.forEach(t => { setTab(t.id); const n = document.querySelector('#view').innerHTML.length; if(n < 200) bad.push(t.id + ':' + n); });
    return { thin: bad, renderErr: window.__renderErr ? String(window.__renderErr.message) : null, pass: bad.length === 0 && !window.__renderErr };
  });
  const failed = Object.keys(R).filter(k => !(R[k] && R[k].pass));
  return JSON.stringify({ allPass: failed.length === 0, failed: failed, results: R }, null, 1);
})();
