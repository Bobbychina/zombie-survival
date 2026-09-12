/* v2.2 Wave 2 验收套件：C15 / C16(+C18 绑定) / C17(含 X06 算式) / C19(+A9) / C20 / C21 / C22 / C23 */
(async function(){
  const R = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const T = async (name, fn) => { try{ R[name] = await fn(); }catch(e){ R[name] = 'ERR: ' + (e && e.message ? e.message : e); } };
  const fresh = () => { S = newState(); battle = null; closeAllModals(); window.__renderErr = null; localStorage.clear(); };

  // ── C17 悬赏板 ──
  await T('C17_board', () => {
    fresh(); S.day = 1; rollBounties();
    const list = S.bounty.list;
    const hasQuest = list.some(b => /^q_\d+$/.test(b.id));
    const budget = bountyBudget();
    S.day = 20; const b20 = bountyBudget(), r20 = +merchantRate().toFixed(2);
    S.day = 50; const b50 = bountyBudget(), r50 = +merchantRate().toFixed(2);
    fresh();
    return { size:list.length, questLinked:hasQuest, budgetDay1:budget, day20:[b20, r20], day50:[b50, r50],
      pass: list.length === 3 && hasQuest && budget === 9 && b20 === 19 && r20 === 1.4 && b50 === 34 && r50 === 2 };
  });
  await T('C17_progress_and_claim', () => {
    fresh(); S.day = 2; S.hpMax = 1e6; S.hp = 1e6;
    rollBounties();
    // 强制一条"搜刮 3 次"的委托，验证推进与领取
    const idx = S.bounty.list.findIndex(b => b.id === 'scav');
    if(idx >= 0) S.bounty.list[idx].base = S.stats.scav;
    else { S.bounty.list[0] = { id:'scav', base:S.stats.scav, prog:0, done:false }; }
    for(let i = 0; i < 4; i++){ S.ap = 9; S.infect = 0; S.hp = 1e6; searchZone('hospital', 0); closeAllModals(); }
    const slot = S.bounty.list.findIndex(b => b.id === 'scav');
    const done = slot >= 0 ? S.bounty.list[slot].done : 'gone';
    const matBefore = S.mat;
    const budgetAtDay2 = bountyBudget();
    if(slot >= 0) claimBounty(slot);
    const gained = S.mat - matBefore;
    const stats = S.stats.bounties;
    fresh();
    return { done, gained, budgetDay2:budgetAtDay2, bountiesStat:stats,
      pass: done === true && gained <= budgetAtDay2 && gained > 0 && stats === 1 };
  });
  await T('C17_budget_cap', () => {
    fresh(); S.day = 1; rollBounties();
    S.bounty.spent = bountyBudget();                      // 预算用尽后只能拿到 0 材料
    S.bounty.list[0].done = true;
    const before = S.mat; claimBounty(0);
    const paid = S.mat - before;
    fresh();
    return { paid, pass: paid === 0 };
  });
  // ── C16 精英词条（封顶 + 每日 1 只） ──
  await T('C16_caps', () => {
    fresh(); S.day = 30; S.eliteToday = 0;
    let elites = 0, maxRatio = 0, dmgChanged = 0;
    for(let i = 0; i < 200; i++){
      const base = ZOMBIES.walker;
      const f = mkFoe('walker');
      if(f.elite){ elites++; maxRatio = Math.max(maxRatio, f.hpMax / Math.round(base.hp * (1 + Math.floor((S.day - 1) / 5) * .22)));
        if(f.dmg !== Math.round(base.dmg * (1 + Math.floor((S.day - 1) / 5) * .14))) dmgChanged++; }
    }
    const cappedAtOnePerDay = S.eliteToday === 1 && elites === 1;
    // 换一天后可以再出
    S.eliteToday = 0; let elites2 = 0;
    for(let i = 0; i < 200; i++) if(mkFoe('walker').elite) elites2++;
    // 指定词条：验证生命封顶 1.5x、伤害不受词条影响
    const baseHp = Math.round(ZOMBIES.walker.hp * (1 + Math.floor((S.day - 1) / 5) * .22));
    const forced = mkFoe('walker');
    S.eliteToday = 0;
    applyAffix(forced, 'corrupt');
    const corruptRatio = +(forced.hpMax / baseHp).toFixed(2);
    const baseDmg = Math.round(ZOMBIES.walker.dmg * (1 + Math.floor((S.day - 1) / 5) * .14));
    const tplIntact = ZOMBIES.walker.armGun === undefined;   // 词条不得污染模板
    fresh();
    return { day30Elites:elites, elitesAfterReset:elites2, maxHpRatio:maxRatio, corruptRatio, dmgBoosted:dmgChanged,
      forcedDmgUnchanged: forced.dmg === baseDmg, tplIntact,
      pass: cappedAtOnePerDay && elites2 === 1 && maxRatio <= 1.5 && corruptRatio > 1.3 && corruptRatio <= 1.5 && dmgChanged === 0 &&
            forced.dmg === baseDmg && tplIntact };
  });
  await T('C16_siege_binding', () => {           // C18 绑定：守夜战里也会出精英
    fresh(); S.day = 25; S.hp = 99999; S.hpMax = 99999;
    let sawElite = 0;
    for(let i = 0; i < 60; i++){
      S.eliteToday = 0; S.over = false; S.hp = 99999;
      nightRaid();
      if(battle && battle.foes.some(f => f.elite)) sawElite++;
      if(battle) battle.foes.forEach(f => { f.hp = 0; f.dead = true; });
      endCombat('flee'); closeAllModals();
    }
    fresh();
    return { siegesWithElite:sawElite, pass: sawElite > 0 };
  });
  // ── C20 区域可辨识度 ──
  await T('C20_zone_silhouettes', () => {
    fresh(); setTab('explore');
    const zones = Object.keys(ZONES);
    const missing = zones.filter(z => !ZONE_SIL[z]);
    const svgs = document.querySelectorAll('#view .zone .zsil path').length;
    const hatch = Array.from(document.styleSheets[0].cssRules).some(r => r.cssText && r.cssText.indexOf('repeating-linear-gradient(180deg') > 0);
    fresh();
    return { zones:zones.length, missing, svgs, hatch, pass: missing.length === 0 && svgs === zones.length && hatch };
  });
  // ── C21 支线 ──
  await T('C21_side_quest', () => {
    fresh(); S.comp = 'vet'; S.compHp = 70; S.compMax = 70;
    const start = S.side.vet;
    addItem('choco', 2, true);
    const ok1 = sideAdvance('vet');                     // 步骤 1：交 2 块巧克力
    // 步骤 2：搜刮军方检查站 3 次
    const key = 'vet:1'; if(S.sideBase[key] === undefined) S.sideBase[key] = metricValue('zone:military');
    S.stats.zoneCnt.military = (S.stats.zoneCnt.military || 0) + 3;
    sideTick();
    // 步骤 3：击杀 5 只装甲丧尸
    const key2 = 'vet:2'; if(S.sideBase[key2] === undefined) S.sideBase[key2] = metricValue('killBy:armored');
    S.stats.killBy.armored = (S.stats.killBy.armored || 0) + 5;
    sideTick();
    const finished = S.side.vet === SIDE_QUESTS.vet.steps.length;
    const gotGun = itemCount('hk_m14') > 0;
    const gotLore = S.lore.indexOf('l_hawk') >= 0;
    const ach = S.ach.indexOf('a_side') >= 0;
    fresh();
    return { start, ok1, finished, gotGun, gotLore, ach, pass: start === 0 && ok1 === true && finished && gotGun && gotLore && ach };
  });
  // ── C22 改装 + 限购 ──
  await T('C22_mods', () => {
    fresh(); S.eq.wpn = 'pistol'; S.base.bench = 1; S.ap = 6;
    S.inv.metal = 20; S.inv.tape = 10; S.inv.cloth = 10; S.inv.chip = 6; S.inv.powder = 6;
    addMod('supp');
    const blockedByBench = modsOf('pistol').length === 0;
    S.base.bench = 2;
    const baseDmg = effDmg(ITEMS.pistol, true).d;
    addMod('supp');
    const afterDmg = effDmg(ITEMS.pistol, true).d;
    addMod('mag');
    const ammoCost = Math.max(1, ITEMS.pistol.ammo + modSum('pistol', 'ammo'));
    addMod('scope');                                     // 第三件应被拒绝（上限 2）
    const capped = modsOf('pistol').length === 2;
    const crit = effDmg(ITEMS.pistol, true).crit;
    fresh();
    return { blockedByBench, dmgDrop:+(baseDmg - afterDmg).toFixed(2), ammoCost, capped, crit:+crit.toFixed(3),
      pass: blockedByBench && afterDmg < baseDmg && ammoCost === 1 && capped };
  });
  await T('C22_shop_limit', () => {
    fresh(); S.day = 5; S.mat = 9999;
    const before = shopLeft(MERCHANT[0]);
    buyMerchant(0); buyMerchant(0); buyMerchant(0);      // stock 2 → 第三次应被拒
    const left = shopLeft(MERCHANT[0]);
    const bought = S.shop.bought[MERCHANT[0].id];
    fresh();
    return { before, left, bought, pass: before === 2 && left === 0 && bought === 2 };
  });
  // ── C15 战斗节拍器 ──
  await T('C15_pace', async () => {
    fresh(); S.ui.pace = 'fast';
    startCombat(['walker'], { title:'pace' });
    const foe = battle.foes[0], hp0 = foe.hp;
    combatAct('shoot');
    const fastResolved = foe.hp < hp0;
    closeAllModals(); battle = null;
    // beat 模式：立即不结算，锁按钮，约 0.5s 后落地
    S.ui.pace = 'beat';
    startCombat(['walker'], { title:'pace-beat' });
    const f2 = battle.foes[0], h2 = f2.hp;
    combatAct('shoot');
    const immediate = { busy: battle.busy, hpUnchanged: f2.hp === h2,
      btnDisabled: !!document.querySelector('#cb-body button[disabled]') };
    await sleep(700);
    const resolved = !battle ? 'ended' : (battle.foes[0].hp < h2);
    const stillOk = !!battle;
    closeAllModals(); battle = null; fresh();
    return { fastResolved, immediate, resolvedLater: resolved, battleAlive: stillOk,
      pass: fastResolved && immediate.busy && immediate.hpUnchanged && immediate.btnDisabled && resolved === true };
  });
  // ── C19 环境底噪 + A9 并发上限 ──
  await T('C19_ambience_cap', () => {
    fresh();
    const hasApi = typeof ambStart === 'function' && typeof ambSync === 'function' && typeof ambMode === 'function';
    S.sfx = true; S.ui.amb = true; ambStart();
    const started = !!AMB.node;
    ambMode('night'); const nightFreq = AMB.node ? AMB.node.frequency.value : -1;
    ambMode('day');   const dayFreq = AMB.node ? AMB.node.frequency.value : -1;
    ambSync();                                        // 开着 → 应保持运行
    const afterSync = !!AMB.node;
    S.ui.amb = false; ambSync();                      // 关掉 → 应停止
    const stopped = !AMB.node;
    for(let i = 0; i < 40; i++) sfx('shoot');         // A9：并发上限
    const live = audioLive;
    fresh();
    return { hasApi, started, nightFreq, dayFreq, afterSync, stopped, liveAfterSpam: live, cap: AUDIO_MAX,
      pass: hasApi && stopped && live <= AUDIO_MAX && (!started || (nightFreq === 44 && dayFreq === 52)) };
  });
  // ── 配乐（程序化生成，跟随局面变奏） ──
  await T('MUSIC_generative', () => {
    fresh();
    const hasApi = typeof musicStart === 'function' && typeof musicStop === 'function' && typeof musicSting === 'function' && typeof musicMood === 'function';
    S.day = 3; S.ap = 6; S.hp = S.hpMax;
    const mDay = musicMood();
    S.ap = 0; const mNight = musicMood();
    S.hp = Math.round(S.hpMax * .2); const mTension = musicMood();
    S.hp = S.hpMax;
    startCombat(['walker'], { title:'m' }); const mCombat = musicMood();
    closeAllModals(); battle = null;
    battle = { foes:[], opts:{ siege:true } }; const mSiege = musicMood(); battle = null;
    S.sfx = true; S.ui.music = true;
    musicStart();
    const started = MUS.on === true && !!MUS.master && MUS.bar >= 1;
    const tempoDay = musicTempo();
    MUS.mood = 'combat'; const tempoCombat = musicTempo();
    MUS.mood = 'night';  const tempoNight = musicTempo();
    musicStop();
    const stopped = MUS.on === false && !MUS.timer;
    S.ui.music = false; ambSync(); const gatedByToggle = MUS.on === false;
    fresh();
    return { hasApi, mDay, mNight, mTension, mCombat, mSiege, started, tempoDay, tempoCombat, tempoNight, stopped,
      gatedByToggle, voiceCap: MUS_MAX,
      pass: hasApi && mDay === 'day' && mNight === 'night' && mTension === 'tension' && mCombat === 'combat' &&
            mSiege === 'siege' && started && tempoDay === 62 && tempoCombat === 132 && tempoNight === 52 &&
            stopped && gatedByToggle && MUS_MAX === 22 };
  });
  // ── C23 工程加固 ──
  await T('C23_iife_exports', () => {
    const src = document.querySelector('script').textContent;
    const wrapped = src.indexOf('(function(){') >= 0 && src.indexOf('C23 工程加固') > 0;
    // 真检查：把页面上所有内联 onclick 里调用的函数名抓出来，逐个确认挂在 window 上
    fresh(); TABS.forEach(t => setTab(t.id));
    const handlers = Array.from(document.querySelectorAll('[onclick]')).map(e => e.getAttribute('onclick'));
    const called = new Set();
    handlers.forEach(h => Array.from(h.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)).forEach(x => called.add(x[1])));
    const missing = Array.from(called).filter(n => typeof window[n] !== 'function');
    const liveState = (typeof window.S === 'object' && window.S === S) && (window.S.day === S.day);
    const liveAudio = (typeof window.audioLive === 'number');
    fresh();
    return { wrapped, handlersChecked:handlers.length, funcsReferenced:called.size, missing, liveState, liveAudio,
      pass: wrapped && missing.length === 0 && handlers.length >= 10 && liveState && liveAudio };
  });
  const failed = Object.keys(R).filter(k => !(R[k] && R[k].pass));
  return JSON.stringify({ allPass: failed.length === 0, failed, results: R }, null, 1);
})();
