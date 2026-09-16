/* M30 · 湿度 / 淋湿 / 病症链的**运行时**（数值全部来自 survival-core，这里只管接存档与写日志）。
 *
 * 为什么单开一个文件而不是塞进 env.ts：env.ts 已经在管季节/天气/体温/菜园，再塞病症链会变成
 * 第二个 legacy（一屏两百行、谁都不敢动）。这里只做三件事：
 *   ① 把"当前环境湿度"算出来并缓存进 S.env.hum（面板/HUD/病症判定都读同一份）；
 *   ② 每次行动推进一次（step 计数 + 病症 stage + 淋湿）；
 *   ③ 把病症换算成属性惩罚，交给 legacy 的 statMods / tickVitals 合并。
 *
 * 一切以"玩家能预判"为准：湿度是天气的导出量（看天就知道），所以窗外的雨就是"今天别出门"的信号。
 */
import { L } from '../main';
import seedrandom from 'seedrandom';
import {
  CONDS, COND_CURE, COND_IDS, COND_OF_ITEM, condPenalty, condPenaltyText, condRisk, dryThirstMul, fireChance,
  forecastKind, FORECAST_INFO, humBand, humLabel, humLine, humidityOf, rotMulOf, tickCond, wetEffect, wetGain,
  type CondId, type CondState,
} from './survival-core';
import { envOf, seasonNow, sheltered, weatherNow } from './env';
import { rollWeather, seasonOf, SEASON_INFO, WEATHER } from './env-core';

/** 每推进多少"步"（一次行动/一次搜刮/一回合战斗）结算一次病症 */
export const STEPS_PER_COND_TICK = 4;

interface SurvState { hum: number; wet: number; conds: CondState[]; steps: number }
let lastLog: Record<string, string> = {};      // 同一句病症提示不要每步都刷屏

/** S.env 上的运行时字段（缺了就补，天然完成老档迁移） */
function st(): SurvState {
  const S = L.S as any;
  const e = envOf() as any;
  if (typeof e.hum !== 'number' || !isFinite(e.hum)) e.hum = humidityOf(weatherNow(), seasonNow(), 0, false);
  if (typeof e.wet !== 'number' || !isFinite(e.wet)) e.wet = 0;
  if (!Array.isArray(e.conds)) e.conds = [];
  if (typeof e.steps !== 'number' || !isFinite(e.steps)) e.steps = 0;
  e.conds = (e.conds as any[]).filter(c => c && CONDS[c.id as CondId]).map(c => ({
    id: c.id as CondId, since: Number(c.since) || S.day || 1, stage: Math.max(0, Number(c.stage) || 0),
  }));
  return e as SurvState;
}

/** 今天用掉了多少行动力（比例）—— 湿度的日内起伏用它 */
function usedRatio(): number {
  const S = L.S as any;
  const cap = Math.max(1, (typeof (window as any).apCapNow === 'function' ? (window as any).apCapNow() : 14));
  return Math.max(0, Math.min(1, 1 - (Number(S.ap) || 0) / cap));
}

/** 有雨衣/防水外套（装备槽里的 hazmat/raincoat 都算） */
function hasRainCloak(): boolean {
  const S = L.S as any;
  const eq = S.eq || {};
  const id = eq.body || eq.armor;
  return id === 'hazmat' || id === 'raincoat' || !!S.hasRainCloak;
}

/** 重算并写回 S.env.hum（面板、HUD、病症判定共用同一份） */
export function refreshHum(): number {
  const e = st();
  e.hum = humidityOf(weatherNow(), seasonNow(), usedRatio(), sheltered());
  return e.hum;
}
export const humidityNow = (): number => st().hum;
export const wetNow = (): number => st().wet;
export const condsNow = (): CondState[] => st().conds;
export const hasCond = (id: CondId): boolean => st().conds.some(c => c.id === id);
export const condNames = (): string[] => st().conds.map(c => CONDS[c.id].name);

/** 病症/湿度对属性的合并惩罚（legacy statMods 读它） */
export const penaltyNow = () => condPenalty(st().conds);
/** 水分消耗倍率（干燥 + 中暑/脱水）与淋湿带来的体温流失倍率 */
export function vitalsMul(): { thirst: number; temp: number } {
  const e = st();
  const dry = dryThirstMul(e.hum, (envOf() as any).temp || 50);
  const cond = condPenalty(e.conds);
  let condThirst = 1;
  for (const c of e.conds) condThirst *= CONDS[c.id].thirstMul;
  return { thirst: dry * condThirst, temp: wetEffect(e.wet).tempMul };
}
/** 生火成功率与腐坏倍率（工作台/营火读它） */
export const fireOk = (): number => fireChance(st().hum);
export const rotMul = (): number => rotMulOf(st().hum);

/** 推进一次：淋湿 → 湿度 → 病症。`units` 让"睡觉/长途"这类大动作一次算多份。 */
export function step(units = 1, why = ''): { hp: number; gained: CondId[] } {
  const S = L.S as any;
  const e = st();
  const n = Math.max(1, Math.round(units));
  let hp = 0;
  const gained: CondId[] = [];
  for (let i = 0; i < n; i++) {
    /* 淋湿：雨雪天在外面会湿，进屋烘干（雨衣减到 1/4） */
    const g = wetGain(weatherNow(), sheltered(), hasRainCloak());
    e.wet = Math.max(0, Math.min(100, e.wet + g));
    refreshHum();
    if (e.steps++ < STEPS_PER_COND_TICK) continue;
    e.steps = 0;
    const before = new Set(e.conds.map(c => c.id));
    const r = tickCond(Number(S.day) || 1, e.conds, {
      hum: e.hum, temp: Number((envOf() as any).temp) || 50, shelter: sheltered(),
      thi: Number(S.thi) || 0, rainCloak: hasRainCloak(),
    });
    e.conds = r.next;
    hp += r.hp;
    for (const c of r.next) if (!before.has(c.id)) gained.push(c.id);
    for (const line of r.logs) {
      const key = line.slice(0, 8);
      if (lastLog[key] === String(S.day)) continue;         // 同一天同一句只报一次
      lastLog[key] = String(S.day);
      L.log(line, /^✅/.test(line) ? 'success' : 'danger');
    }
  }
  if (hp < 0) L.S.hp = Math.max(0, L.S.hp + hp);
  return { hp, gained };
}

/** 过夜：一次算 3 份（夜里病程推进会更快，也让"病了就早睡"有意义） */
export const nightStep = () => step(3, 'night');

/** 病了 → 体力上限被压（tickVitals 里对 sta 封顶用） */
export const staCapMul = (): number => condPenalty(st().conds).apMul;
/** 干燥天喝水收益（喝水的地方乘它：0.7 = 只补七成） */
export const drinkGain = (): number => (humBand(st().hum) === 'dry' ? 0.7 : 1);

/** HUD chips（跟体温/季节并排）——M50 起 HUD 不再显示它们，这一份留给探针与老入口 */
export function survivalChips(): string {
  const e = st();
  const band = humBand(e.hum);
  const cls = band === 'dry' ? 'heavy' : band === 'muggy' ? 'cold' : '';
  let h = `<span class="chip ${cls}" title="${humLine(e.hum, e.wet)}">${band === 'dry' ? '🏜️' : band === 'muggy' ? '🌫️' : '💧'} <b>${Math.round(e.hum)}%</b></span>`;
  if (e.wet >= 25) h += `<span class="chip cold" title="淋湿会让体温掉得更快，回屋/火堆旁烘干">🌧️ <b>${Math.round(e.wet)}</b></span>`;
  for (const c of e.conds) {
    const d = CONDS[c.id];
    h += `<span class="chip heavy" style="border-color:${d.color}" title="${d.hud}">${d.icon} <b>${d.name}</b></span>`;
  }
  return h;
}

/* ── M50：主动治疗（人体页的按钮 + 背包里吃药都走这里） ── */
export interface CondRow {
  id: CondId; name: string; icon: string; color: string;
  symptom: string; penalty: string; cure: string;
  since: number; days: number;
  /** 治病要用的东西 */
  item: string; itemName: string; have: number; need: number; how: string;
}

/** 当前病症的结构化列表（人体页/图鉴/探针共用一份口径） */
export function condRows(): CondRow[] {
  const S = L.S as any;
  return st().conds.map(c => {
    const d = CONDS[c.id], cure = COND_CURE[c.id];
    const item = cure.item;
    return {
      id: c.id, name: d.name, icon: d.icon, color: d.color,
      symptom: d.symptom, penalty: condPenaltyText(c.id), cure: d.cure,
      since: c.since, days: Math.max(1, (Number(S.day) || 1) - (Number(c.since) || 1) + 1),
      item, itemName: L.itemName(item), have: L.itemCount(item), need: cure.n, how: cure.how,
    };
  });
}

/** 吃药治病：扣药 → 病症立刻消失（不用再等环境回落）。返回一句话结论。 */
export function treatCond(id: CondId): { ok: boolean; msg: string } {
  const S = L.S as any;
  const e = st();
  const d = CONDS[id];
  if (!d) return { ok: false, msg: '没有这种病' };
  if (!e.conds.some(c => c.id === id)) return { ok: false, msg: '现在没有' + d.name };
  const cure = COND_CURE[id];
  const have = L.itemCount(cure.item);
  if (have < cure.n) return { ok: false, msg: '没有' + L.itemName(cure.item) + '（' + cure.how + '）' };
  L.takeItem(cure.item, cure.n);
  e.conds = e.conds.filter(c => c.id !== id);
  /* 脱水/中暑这两条是"身体缺水"的账：吃药顺手补一口，别让玩家治完还渴死 */
  if (id === 'dehydration' || id === 'heatstroke') S.thi = Math.min(100, (Number(S.thi) || 0) + 18);
  L.log('💊 ' + d.icon + d.name + '：' + cure.how + '（' + L.itemName(cure.item) + '×' + cure.n + '）——症状压下去了。', 'success');
  L.addXP('medic', 3);
  L.sfx('ok');
  L.autosave(); L.render();
  return { ok: true, msg: '已处理' + d.name };
}

/** 背包里「使用」某件药时顺手治病（抗生素/抗真菌药）。治好了返回病名，否则 null。 */
export function treatByItem(itemId: string): string | null {
  const id = COND_OF_ITEM[itemId];
  if (!id) return null;
  if (!st().conds.some(c => c.id === id)) return null;
  const r = treatCond(id);
  return r.ok ? CONDS[id].name : null;
}

/** 探针/调试：一次拿到"有哪些病、各要什么药、手上有几份" */
export const condStatus = () => condRows().map(r => ({ id: r.id, name: r.name, item: r.item, have: r.have, need: r.need, days: r.days }));
export const humNow = (): { hum: number; band: string; label: string; wet: number } => {
  const e = st();
  return { hum: e.hum, band: humBand(e.hum), label: humLabel(e.hum), wet: e.wet };
};

/** 环境面板里那一行 */
export function survivalLine(): string {
  const e = st();
  const list = e.conds.length ? e.conds.map(c => CONDS[c.id].icon + CONDS[c.id].name).join('、') : '无';
  const w = WEATHER[weatherNow()];
  return `${humLine(e.hum, e.wet)} · 生火 ${Math.round(fireOk() * 100)}% · 病症：${list}` +
    ` · 明日${SEASON_INFO[seasonNow()].name}季${w.icon}${w.name}`;
}

/** 病症风险提示（床前/出门前给玩家看一眼，避免"莫名其妙就病了"） */
export function riskLine(): string {
  const e = st();
  const { gain } = condRisk({
    hum: e.hum, temp: Number((envOf() as any).temp) || 50, shelter: sheltered(),
    thi: Number(L.S.thi) || 0, rainCloak: hasRainCloak(),
  });
  if (!gain.length) return '这一带的气候对身体没威胁。';
  return '⚠️ 现在的气候容易得：' + gain.map(id => CONDS[id].icon + CONDS[id].name).join('、');
}

/** 探针/调试：一次性把当前状态交出去 */
export const survivalStatus = () => {
  const e = st();
  return { hum: e.hum, wet: e.wet, conds: e.conds.map(c => c.id), steps: e.steps, tags: COND_IDS.length };
};

/** 湿度计的预报表（用一次看三天）：确定性 —— 与 envDayTick 同一个 rng 种子，所以预报永远是真的 */
export function forecastLines(n = 3): string[] {
  const S = L.S as any;
  const seed = S.world?.seed ?? 'ember-01';
  const out: string[] = [];
  for (let d = 1; d <= n; d++) {
    const day = (Number(S.day) || 1) + d;
    const w = rollWeather(seedrandom(`${seed}:weather:${day}`), seasonOf(day));
    const info = WEATHER[w];
    const hum = humidityOf(w, seasonOf(day), 0.5, false);
    const fx = forecastKind(w);
    out.push(`第 ${day} 天 ${info.icon}${info.name}（湿度 ${hum}% · ${FORECAST_INFO[fx].hint}）`);
  }
  return out;
}
