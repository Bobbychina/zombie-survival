/* M31 · 人体与伤病的**运行时 + 人体页 UI**（数值全部来自 medical-core，这里管存档、战斗钩子与渲染）。
 *
 * 分页怎么接进来的：legacy 的 `render()` 在挑渲染函数之前会先问一句
 * `window.V4Medical.renderTab(S.tab)` —— 返回字符串就用它，返回 null 就走原来的页面。
 * 页签本身是 legacy 的 `TABS` 数组（在 game.ts 里加了一条 `body`）。
 *
 * 战斗怎么接进来：v4 战斗的玩家掉血有四个入口（近战、爆炸、毒/燃烧、 siege），
 * 在每个入口里插一行太容易漏，所以统一在 `V4UI.move` 的**事件流**上拦：
 * 那次行动里 `target.side === 'player'` 的伤害事件累计起来，交给 applyHit 判定伤病。
 */
import { L } from '../main';
import {
  INJURIES, PARTS, PART_INFO, applyHit, bodyFromHp, bodyPenalty, bodySummary, headVisionLoss, hudLine, infectNight,
  infectionLine, isSuppressedToday, openInfectedWounds,
  scavMulOf, tickBody, travelExtra, treat, treatOptions, type BodyPart, type BodyState,
} from './medical-core';
import { envOf, seasonNow, tempPenalty, weatherNow } from './env';
import { SEASON_INFO, WEATHER, tempStateText, tempText } from './env-core';
import { condRows, fireOk, humNow, riskLine, rotMul } from './survival';
import { CONDS, COND_CURE, COND_IDS, condPenaltyText, humBand, humLine } from './survival-core';
import { radSymptomTable, radSymptomText, radSymptoms } from './rad-core';
/* M68：探针与 HUD 也要读这两条"伤 → 动作"的换算，从 medical 这一层透出去（V4Debug 用） */
export { headVisionLoss, scavMulOf, scavYield } from './medical-core';
/* M69：感染链的纯函数出口（legacy 夜晚结算、HUD、探针共用） */
export { infectNight, infectionLine, openInfectedWounds } from './medical-core';
/** M69 钩子：legacy 的 sleepNight 里那段感染涨落改走这里（拿不到就退回老逻辑） */
export const infectNightHook = infectNightNow;
if (typeof window !== 'undefined') (window as any).__v4InfectNight = () => infectNightNow();

let steps = 0;
const STEPS_PER_BODY_TICK = 4;                 // 与 survival 同一个节奏：每 4 步走一次病程
/** HTML 转义（人体页把物品名/描述拼进 innerHTML，必须转义） */
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

/** S.body 的读写（缺了就按当前 HP 比例建一份：老档迁移口径） */
export function bodyNow(): BodyState {
  const S = L.S as any;
  if (!S.body || typeof S.body !== 'object' || !S.body.parts) {
    const hp = Number(S.hp) || 100, hpMax = Number(S.hpMax) || 100;
    S.body = bodyFromHp(hp, hpMax, Number(S.day) || 1);
  }
  const b = S.body as BodyState;
  for (const p of PARTS) if (typeof b.parts[p] !== 'number' || !isFinite(b.parts[p])) b.parts[p] = 100;
  if (!Array.isArray(b.injuries)) b.injuries = [];
  if (typeof b.bleedSince !== 'number') b.bleedSince = Number(S.day) || 1;
  return b;
}
const setBody = (b: BodyState): void => { (L.S as any).body = b; };

/** 战斗钩子：一次行动里玩家掉了多少血 → 判定伤病 */
export function onPlayerHurt(dmg: number): void {
  if (!(dmg > 0)) return;
  const S = L.S as any;
  const b = bodyNow();
  /* 护甲来源：M25 的护甲值（背心 +2 / 防弹衣 +5）——护甲不是免疫，只是"少挨一刀深的" */
  const armor = (S.eq?.body === 'kevlar' ? 5 : S.eq?.body === 'vest' ? 2 : 0) + (S.eq?.head === 'helmet' ? 1 : 0);
  const res = applyHit(b, dmg, Number(S.hpMax) || 100, Number(S.day) || 1, Math.random, { armor });
  setBody(res.body);
  for (const line of res.logs) L.log(line, 'danger');
  if (res.logs.length) L.sfx('bad');
}

/** 每 tick：出血掉血 + 康复。legacy 的 tickVitals 里每步调用一次，内部按步数节流。 */
export function stepBody(): void {
  const S = L.S as any;
  const b = bodyNow();
  /* 未处理的出血每一小段就扣一次血（"不处理会死"必须是真的） */
  const pen = bodyPenalty(b);
  if (pen.bleed > 0 && steps % 2 === 0) {
    const dmg = Math.max(1, Math.round(pen.bleed * 0.5));
    S.hp = Math.max(0, Number(S.hp) - dmg);
    if (steps % 8 === 0) L.log(`🩸 伤口还在流血（-${dmg}），先止血再赶路。`, 'danger');
  }
  if (steps++ < STEPS_PER_BODY_TICK) return;
  steps = 0;
  const r = tickBody(b, Number(S.day) || 1, { nutrition: Number(S.hun) || 0, resting: S.loc === 'base' });
  setBody(r.body);
  if (r.hp < 0) S.hp = Math.max(0, Number(S.hp) + r.hp);
  for (const line of r.logs) L.log(line, 'success');
}

/** 过夜：不节流、直接走一次完整结算（康复在夜里翻倍，所以这一下要真的算） */
export function nightBody(): void {
  const S = L.S as any;
  steps = STEPS_PER_BODY_TICK;                 // 让下一次 stepBody 立刻结算（而不是被节流吞掉）
  const b = bodyNow();
  const r = tickBody(b, Number(S.day) || 1, { nutrition: Number(S.hun) || 0, resting: true, infect: Number(S.infect) || 0 });
  setBody(r.body);
  if (r.hp < 0) S.hp = Math.max(0, Number(S.hp) + r.hp);
  for (const line of r.logs) L.log(line, 'success');
  steps = 0;
}

/* ── M69：把"感染伤口"接到"全身感染值"上 ──
   legacy 的夜晚结算（sleepNight 里那段 S.infect 的涨落）通过这个钩子走 v4 的纯函数：
   带着没清创的伤口过夜 → 感染 +4/处且**不再自然消退**；吃过抗生素 → 当晚不推进。 */
export function infectNightNow(): { infect: number; logs: { text: string; kind: string }[]; woundPush: number } {
  const S = L.S as any;
  const b = bodyNow();
  const day = Number(S.day) || 1;
  const r = infectNight({
    infect: Number(S.infect) || 0,
    openWounds: openInfectedWounds(b).length,
    hun: Number(S.hun) || 0,
    thi: Number(S.thi) || 0,
    medicLv: Number(S.skills?.medic) || 0,
    suppressedToday: isSuppressedToday(b, day),
  });
  S.infect = r.infect;
  return r;
}
export const infectionStatus = (): string => infectionLine(Number((L.S as any).infect) || 0, bodyNow());

/* ── 给 legacy / HUD / 探针用的查询 ── */
export const bodyStatus = () => {
  const b = bodyNow();
  return { parts: { ...b.parts }, injuries: b.injuries.map(i => ({ ...i })), penalty: bodyPenalty(b) };
};
export const bodyHudLine = (): string => hudLine(bodyNow());
export const bodyPenaltyNow = () => bodyPenalty(bodyNow());
export const bodyTravelExtra = (): number => travelExtra(bodyNow());

/** 治疗入口（人体页按钮 + 探针）：按"部位 + 道具"治，返回一句话结论 */
export function treatPart(part: BodyPart, item: string): { ok: boolean; msg: string } {
  const S = L.S as any;
  const b = bodyNow();
  if (!L.has(item)) return { ok: false, msg: '没有 ' + L.itemName(item) };
  const opts = treatOptions(b, part);
  const opt = opts.find(o => o.item === item);
  if (!opt) return { ok: false, msg: PART_INFO[part].name + '现在用不上 ' + L.itemName(item) };
  if (opt.done) return { ok: false, msg: PART_INFO[part].name + '已经处理过了' };
  /* 手术需要医疗台在场（在安全屋/有医疗台的据点） */
  if (opt.kind === 'surgery' && !hasMedlab()) return { ok: false, msg: '手术要回据点（或在有医疗台的营地）做' };
  const medicLv = Number(S.skills?.medic) || 0;
  const r = treat(b, part, item, Number(S.day) || 1, medicLv, Math.random);
  if (!r.ok || !r.body) return { ok: false, msg: r.why ?? '处理失败' };
  L.takeItem(item, 1);
  setBody(r.body);
  if (r.log) L.log(r.log, r.log.indexOf('失败') >= 0 ? 'danger' : 'success');
  L.addXP('medic', opt.kind === 'surgery' ? 6 : 3);
  L.autosave(); L.render();
  return { ok: true, msg: r.log ?? '处理完成' };
}

/** 有没有医疗台（据点建了 medlab 或有医疗包的营地） */
function hasMedlab(): boolean {
  const S = L.S as any;
  const lv = Number(S.base?.medlab) || 0;
  if (lv > 0) return true;
  return S.loc === 'base' && Number(S.base?.bench) > 0;      // 据点里用工作台凑合（手术成功率一样，但要有工具）
}

/* ── 人体页渲染（SVG 方块人形） ── */
/** 颜色：部位血量 → 绿→黄→红（一眼看出哪里坏了） */
const partColor = (v: number): string => (v >= 75 ? '#6fbf8a' : v >= 50 ? '#c6d06a' : v >= 25 ? '#e0b45c' : '#ef6f6f');

function figureSvg(b: BodyState): string {
  const fill = (p: BodyPart) => partColor(b.parts[p]);
  const inj = (p: BodyPart) => {
    const i = b.injuries.find(x => x.part === p);
    return i ? '<circle cx="0" cy="0" r="3.2" fill="' + INJURIES[i.id].color + '" stroke="#0b0e12" stroke-width="0.8"/>' : '';
  };
  /* 方块人形：头 + 躯干（胸/腹）+ 两条手臂 + 两条腿。就几个方块，但"哪里伤了"一眼能看懂。
     每个方块可点（onclick=V4Medical.pick('part')），选中的部位在右侧面板里做治疗。 */
  const part = (p: BodyPart, x: number, y: number, w: number, h: number, label: string) =>
    `<g class="mpart" data-part="${p}" onclick="V4Medical.pick('${p}')" style="cursor:pointer">
       <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill(p)}" stroke="#0b0e12" stroke-width="1.4"/>
       <text x="${x + w / 2}" y="${y + h / 2 + 3}" text-anchor="middle" font-size="8" fill="#0b0e12" font-weight="700">${label}</text>
       <g transform="translate(${x + w - 4},${y + 4})">${inj(p)}</g>
     </g>`;
  return `<svg class="mfig" viewBox="0 0 120 200" width="180" height="300" role="img" aria-label="人体伤情图">
    ${part('head', 45, 4, 30, 26, '头')}
    ${part('torso', 42, 34, 36, 40, '胸')}
    ${part('belly', 42, 78, 36, 30, '腹')}
    ${part('armL', 20, 36, 18, 66, '左臂')}
    ${part('armR', 82, 36, 18, 66, '右臂')}
    ${part('legL', 44, 112, 15, 84, '左腿')}
    ${part('legR', 61, 112, 15, 84, '右腿')}
  </svg>`;
}

let picked: BodyPart = 'torso';
export function pick(part: BodyPart): void { picked = part; L.render(); }

function treatmentHtml(b: BodyState): string {
  const inj = b.injuries.find(i => i.part === picked);
  const pi = PART_INFO[picked];
  let h = '<div class="card" style="padding:10px"><h3>' + pi.icon + ' ' + pi.name + ' · ' + Math.round(b.parts[picked]) + '%</h3>';
  if (!inj) {
    h += '<div class="hint">这个部位没有伤。' + (b.parts[picked] < 90 ? '（血量偏低：休息与吃饱会自己回来）' : '（状态良好）') + '</div>';
  } else {
    const d = INJURIES[inj.id];
    h += '<div class="hint" style="color:' + d.color + '"><b>' + d.icon + d.name + '</b> —— ' + d.desc + '</div>';
    h += '<div class="hint">怎么治：' + d.cure + '　' + (inj.done ? '（已手术，康复中）' : inj.field ? '（已急救，等手术）' : '（还没处理）') + '</div>';
    const opts = treatOptions(b, picked);
    const btns = opts.filter(o => !o.done).map(o => {
      const have = L.has(o.item);
      const tag = o.kind === 'surgery' ? '手术' : '急救';
      return '<button class="btn sm ' + (have ? 'ok' : '') + '" ' + (have ? '' : 'disabled') +
        ' onclick="V4Medical.treat(\'' + picked + '\',\'' + o.item + '\')" title="' + esc(L.ITEMS[o.item]?.desc ?? '') + '">' +
        (o.kind === 'surgery' ? '🧰' : '🩹') + ' ' + tag + '：' + esc(L.itemName(o.item)) + (have ? '' : '（没有）') + '</button>';
    });
    h += '<div class="row" style="margin-top:8px">' + (btns.length ? btns.join('') : '<span class="hint">已经没有可用手段了，等它自己好。</span>') + '</div>';
    if (opts.some(o => o.kind === 'surgery' && !o.done)) h += '<div class="hint">手术要回据点、并且成功率与<b>医疗技能</b>挂钩（当前 ' + (Number((L.S as any).skills?.medic) || 0) + ' 级）。</div>';
  }
  return h + '</div>';
}

/* ── M50：体温 / 湿度 / 病症 —— 用户要求「把所有的体温啊病情啊啥的都移到人体 subpage 内」。
   这一块以前散在顶栏 chips 与探索页环境卡里，人体页反而只讲部位伤。现在人体页是身体与环境
   的唯一主场：数值 + 档位 + 症状 + 治疗按钮都在这里（HUD 不再显示，见 main.ts 的 paintEnv）。 */
function envCondHtml(): string {
  const e = envOf();
  const p = tempPenalty(e.temp);
  const hum = humNow();
  const season = seasonNow(), w = WEATHER[weatherNow()];
  const band = humBand(hum.hum);
  const tempTxt = tempStateText(e.temp, true);      // M52：体温对外一律摄氏度
  const humNote = band === 'dry' ? '干燥：容易中暑/脱水' : band === 'muggy' ? '闷湿：容易呼吸道感染与真菌' : '适宜：没有额外影响';
  return '<div class="card" style="padding:10px"><h3>🌡️ 体温与环境</h3>' +
    '<div class="kv"><span>🌡️ 体温</span><b>' + tempText(e.temp) + ' · ' + tempTxt + '</b></div>' +
    '<div class="kv"><span>💧 湿度</span><b>' + Math.round(hum.hum) + '% · ' + hum.label + '</b></div>' +
    '<div class="hint">' + esc(humNote) + (hum.wet >= 25 ? ' · 🌧️ 淋湿 ' + Math.round(hum.wet) + '%（体温掉得更快，回屋/火堆烘干）' : '') + '</div>' +
    '<div class="kv"><span>🍂 季节天气</span><b>' + SEASON_INFO[season].icon + SEASON_INFO[season].name + '季 · ' + w.icon + w.name + '</b></div>' +
    '<div class="hint">生火成功率 ' + Math.round(fireOk() * 100) + '% · 生鲜腐坏 ×' + rotMul().toFixed(2) +
    ' · 明日 ' + WEATHER[envOf().tomorrow].icon + WEATHER[envOf().tomorrow].name + '</div>' +
    (p.note ? '<div class="hint" style="color:#e0b06a">' + esc(p.note) + '</div>' : '') +
    '</div>';
}

/** 病症卡：每条病给症状、代价、怎么好，手上有药就能当场点掉（M50 的核心） */
function condsHtml(): string {
  const rows = condRows();
  let h = '<div class="card" style="padding:10px"><h3>🦠 病症 <span class="sub">' +
    (rows.length ? rows.length + ' 项在身' : '无') + '</span></h3>';
  if (!rows.length) {
    h += '<div class="hint">身上没有病症。气候引起的病会先给一句风险提示：</div>';
  } else {
    h += '<div class="grid" style="gap:6px">';
    for (const r of rows) {
      const can = r.have >= r.need;
      h += '<div class="lrow" style="flex-direction:column;align-items:stretch;gap:4px;border-left:3px solid ' + r.color + '">' +
        '<div class="row"><span class="nm" style="color:' + r.color + '">' + r.icon + ' ' + r.name + '</span><span class="spacer"></span>' +
        '<span class="hint mono">第 ' + r.since + ' 天起 · 已 ' + r.days + ' 天</span></div>' +
        '<div class="hint">症状：' + esc(r.symptom) + '</div>' +
        '<div class="hint">代价：' + esc(r.penalty) + '</div>' +
        '<div class="hint">怎么好：' + esc(r.cure) + '</div>' +
        '<div class="row"><button class="btn sm ' + (can ? 'ok' : '') + '"' + (can ? '' : ' disabled') +
        ' onclick="V4Survival.treat(\'' + r.id + '\')" title="' + esc(r.how) + '">💊 ' + esc(r.how) +
        ' · ' + esc(r.itemName) + '×' + r.need + '（有 ' + r.have + '）</button></div>' +
        '</div>';
    }
    h += '</div>';
  }
  h += '<div class="hint" style="margin-top:6px">' + esc(riskLine()) + '</div>';
  h += '<div class="hint">病症拖久了会留后遗症（体力上限回不满）；完整对照表在 <b>图鉴 → 📘 治疗指南</b>。</div>';
  return h + '</div>';
}

/** M50：治疗指南（原来贴在人体页右下角，用户要求搬进图鉴）。
 *  内容全部从 medical-core 的 INJURIES 与 survival-core 的 CONDS 生成，不手抄第二份。 */
export function guideHtml(): string {
  const inj = [...new Map(Object.values(INJURIES).map(d => [d.icon + d.name, d])).values()];
  let h = '<div class="grid g2" style="gap:10px">';
  h += '<div class="card"><h3>🩸 伤情怎么处理</h3><div class="hint">' +
    inj.map(d => d.icon + ' <b>' + esc(d.name) + '</b>：' + esc(d.cure)).join('<br>') + '</div>' +
    '<div class="hint" style="margin-top:6px">流血不会自己停：先绷带/急救包止血，再找机会动手术（手术要回据点，成功率与医疗技能挂钩）。</div></div>';
  h += '<div class="card"><h3>🦠 病症怎么处理</h3><div class="hint">' +
    COND_IDS.map(id => {
      const d = CONDS[id], c = COND_CURE[id];
      return d.icon + ' <b>' + esc(d.name) + '</b>：' + esc(d.cure) +
        '　<span class="mono">（' + esc(c.item === 'water' ? '净水' : c.how) + ' · 代价 ' + condPenaltyText(id) + '）</span>';
    }).join('<br>') +
    '</div><div class="hint" style="margin-top:6px">气候病会自己消退（回到舒适区 + 撑过两段），但拖久了留后遗症；手上有药就在 <b>人体</b> 页点一下，当场压下去。</div>' +
    '<div class="hint">湿度与体温的档位看 <b>人体 → 🌡️ 体温与环境</b>：干燥容易中暑/脱水，闷湿容易呼吸道感染与真菌。</div></div>';
  /* M58：辐射分档对照表（数值全部来自 rad-core 的 RAD_SYMPTOMS，不手抄） */
  h += '<div class="card" style="grid-column:1/-1"><h3>☢️ 辐射怎么处理</h3><div class="hint">' +
    radSymptomTable().map(s => '☢️ <b>' + esc(s.label) + '</b>（' + esc(radValueRange(s)) + '）：' + esc(radSymptomText(s)) +
      '<br><span style="opacity:.8">　怎么办：' + esc(s.care) + '</span>').join('<br>') +
    '</div><div class="hint" style="margin-top:6px">剂量只涨不回的地方是核电站与废料场周边（贴得越近涨得越快，有盖革计数器才看得见级别）；' +
    '防护服/防毒面具能挡一部分，碘片（-25）与抗辐射药（-55）在 <b>人体 → ☢️ 辐射</b> 卡上一键吃。</div></div>';
  h += '</div>';
  return h;
}

/** 症状档对应的辐射值区间（从档位反推，不另立阈值表） */
function radValueRange(s: { tier: number }): string {
  return ['0–24', '25–49', '50–74', '75–94', '95–100'][s.tier] || '—';
}

/** M58：辐射卡 —— 白天症状原来只有 HUD 一个数字，看不见后果；现在分档后果与"吃什么药"摊在同一张卡上。
 *  掉的那部分剂量仍走 legacy 的 useConsumable（同一本账），这里只负责显示与按钮。 */
const RAD_MEDS: { id: string; name: string; cut: number }[] = [
  { id: 'iodine', name: '碘片', cut: 25 },
  { id: 'radaway', name: '抗辐射药', cut: 55 },
];
function radHtml(): string {
  const S = L.S as any;
  const rad = Math.max(0, Math.min(100, Number(S.rad) || 0));
  const rs = radSymptoms(rad);
  let h = '<div class="card" style="padding:10px"><h3>☢️ 辐射 <span class="sub">' +
    (rs.tier <= 0 ? '干净' : Math.round(rad) + ' / 100 · ' + rs.label) + '</span></h3>';
  if (rs.tier <= 0) {
    return h + '<div class="hint">体内没有积存辐射。贴着核电站/废料场走会涨，涨了就回来开这张卡。</div></div>';
  }
  h += '<div class="hint">白天症状：<b>' + esc(radSymptomText(rs)) + '</b></div>';
  h += '<div class="hint">' + esc(rs.note) + '</div>';
  h += '<div class="hint" style="color:#e0b06a">' + esc(rs.care) + '</div>';
  h += '<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">';
  for (const m of RAD_MEDS) {
    const have = Number(L.itemCount(m.id)) || 0;
    h += '<button class="btn sm ' + (have ? 'ok' : '') + '"' + (have ? '' : ' disabled') +
      ' onclick="useConsumable(\'' + m.id + '\')" title="' + esc(L.itemName(m.id)) + '：体内辐射 -' + m.cut + '">💊 ' +
      esc(m.name) + ' ×' + have + '（-' + m.cut + '）</button>';
  }
  h += '</div><div class="hint" style="margin-top:4px">这两样只压体内剂量；射线还会打折**药效与包扎的治疗量**（重度档只剩一半），先吃药再打架。</div>';
  return h + '</div>';
}

/** 人体页整体（由 legacy 的 render() 调用） */
export function renderBodyTab(): string {
  const S = L.S as any;
  const b = bodyNow();
  const pen = bodyPenalty(b);
  const sum = bodySummary(b, Number(S.hp) || 0, Number(S.hpMax) || 100);
  let h = '<div class="card"><div class="row" style="align-items:flex-start;gap:14px">';
  h += '<div>' + figureSvg(b) + '<div class="hint" style="text-align:center">点头方块选部位</div></div>';
  h += '<div style="flex:1;min-width:260px">';
  h += '<h3>🩺 人体状态</h3>';
  h += '<div class="hint">' + esc(sum.text) + '</div>';
  /* M69：把「全身感染值」和「没清创的伤口」并排写出来 —— 玩家才知道"再拖一晚要掉多少" */
  h += '<div class="hint" style="color:#b98ad8">' + esc(infectionStatus()) + '</div>';
  /* 双轨制的说明：单条 HP 管生死、部位伤管能力（用户选的那条） */
  h += '<div class="hint">生命条决定<b>生死</b>（归零即倒）；下面的部位伤只影响<b>能力与行动</b>：' +
    '命中 ' + (pen.hit ? Math.round(pen.hit * 100) + '%' : '正常') +
    ' · 闪避 ' + (pen.dodge ? Math.round(pen.dodge * 100) + '%' : '正常') +
    ' · 伤害 ×' + pen.dmgMul.toFixed(2) +
    ' · 负重 ×' + pen.carryMul.toFixed(2) +
    ' · 走路 ' + (pen.moveMul > 1.05 ? '+' + travelExtra(b) + ' 行动力' : '正常') +
    (pen.bleed > 0 ? ' · <b style="color:#ef6f6f">持续流血 ' + pen.bleed.toFixed(1) + '/步</b>' : '') + '</div>';
  /* M68：把"这条伤让你损失了什么"讲到底 —— 以前手臂/头的伤在 UI 上找不到任何后果说明 */
  {
    const scav = scavMulOf(b), vloss = headVisionLoss(b);
    if (scav < 0.95 || vloss) {
      h += '<div class="hint" style="color:#e0b45c">你现在干活更费劲：' +
        (scav < 0.95 ? '<b>搜刮产出 -' + Math.round((1 - scav) * 100) + '%</b>（手臂伤：材料与额外掉落都会打折）' : '') +
        (scav < 0.95 && vloss ? ' · ' : '') +
        (vloss ? '<b>视野 -1 圈</b>（头部伤：走一步能点亮的格子变少，迷雾推得慢）' : '') +
        '</div>';
    }
  }
  h += '<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:8px">';
  for (const p of PARTS) {
    const inj = b.injuries.find(i => i.part === p);
    h += '<span class="chip" style="border-color:' + partColor(b.parts[p]) + '" onclick="V4Medical.pick(\'' + p + '\')" title="点一下选中这个部位">' +
      PART_INFO[p].icon + PART_INFO[p].name + ' ' + Math.round(b.parts[p]) + '%' + (inj ? ' ' + INJURIES[inj.id].icon + INJURIES[inj.id].name : '') + '</span>';
  }
  h += '</div></div></div></div>';
  /* M50：体温/湿度/病症搬到这一页 —— 左边是"你现在处在什么环境里"，右边是"身上有什么病、吃什么药" */
  h += '<div class="row" style="align-items:flex-start;gap:10px;flex-wrap:wrap;margin-top:10px">';
  h += '<div style="flex:1;min-width:280px">' + envCondHtml() + '</div>';
  h += '<div style="flex:1;min-width:280px">' + condsHtml() + '</div>';
  h += '</div>';
  h += '<div style="margin-top:10px">' + radHtml() + '</div>';
  h += '<div style="margin-top:10px">' + treatmentHtml(b) + '</div>';
  return h;
}

/** legacy 的 render() 用它决定"这一页要不要交给我" */
export function renderTab(tab: string): string | null {
  if (tab !== 'body') return null;
  try { return renderBodyTab(); } catch (e) { console.error('[v4] 人体页渲染失败', e); return '<div class="card"><h3>⚠️ 人体页渲染出错</h3><div class="hint">' + esc(String(e)) + '</div></div>'; }
}
