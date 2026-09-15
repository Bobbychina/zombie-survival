/* M30 · 湿度 / 中暑 / 湿病 / 病症链的**纯逻辑与唯一数值表**（不碰 DOM、不碰 legacy，可单测）。
 *
 * 用户原话：「添加比如湿度高了容易得病，湿度低了容易脱水中暑」。
 *
 * 口径（M30 讨论时锁定的四条）：
 *   ① 湿度是**环境值**（跟天气与季节走），再乘到**身体水分流失**上；不是又一条要玩家自己回落的条。
 *      理由：湿度对玩家的意义在"今天该不该出门、该不该生火"，不在数字本身。
 *   ② 两个硬阈值：< 20% 干燥（中暑 / 脱水加速）、> 85% 闷湿（呼吸道 / 真菌）；
 *      20~85% 之间**没有额外效果** —— 中间那段"舒服区"必须存在，否则玩家永远在被惩罚。
 *   ③ 湿度还影响两件低成本、高感知的事：生鲜腐坏速度（闷湿烂得快）与生火难度（潮了点不着）。
 *   ④ 病症的可见性分层：HUD 给数值，人体页（M31）给症状文案。所以这里只产出**结构化状态**，
 *      文案由各自的 UI 决定。
 *
 * 病症链一共 4 种，各自有"进入 → 持续 → 解除"三段：
 *   中暑   （干燥 + 高温）  ：体力上限 −30%、命中 −15%、每段时间掉血；进屋/降温 + 喝水消退
 *   脱水   （干燥，任何温度）：饥渴消耗 ×1.5、喝水收益 −30%；补足水消退
 *   呼吸道 （闷湿 + 偏冷）  ：体力上限 −15%、命中 −10%；着火堆/进屋 + 吃药消退
 *   真菌   （闷湿 + 偏热）  ：持续掉体力、伤口愈合变慢；抗真菌药消退
 */
import type { Season, WeatherId } from './env-core';

/* ── 湿度 ── */
export const DRY_AT = 20;             // 低于它 = 干燥（中暑 / 脱水）
export const MUGGY_AT = 85;           // 高于它 = 闷湿（呼吸道 / 真菌）
export const HEAT_AT = 68;            // 体温高于它算"热"（与 env-core 的 TEMP_HIGH=80 分工：这里管"难受"）
export const CHILL_AT = 38;           // 体温低于它算"凉"（呼吸道入口）
export const HUMIDITY_DEFAULT = 55;

/** 天气对湿度的**基础值**：湿度是天气的导出量，所以玩家能靠"看天"预判（M30 决策）。 */
const WEATHER_HUM: Record<WeatherId, number> = {
  clear: 42, cloudy: 58, rain: 92, storm: 92, fog: 88, snow: 72, heat: 12, cold: 66,
};
/** 季节对湿度的偏移：春多雨、夏闷热、秋干燥、冬干冷 */
const SEASON_HUM: Record<Season, number> = { spring: 3, summer: 2, autumn: -6, winter: -4 };
/** 一天之内的湿度起伏（清晨最潮、午后最干）：按"今天用掉了多少行动力"的比例给 */
const DIURNAL = [2, 1, -4, -6, -5, -2, 1, 2];

/**
 * 当前环境湿度（0~100）。
 * @param usedRatio 今天已用行动力 / 上限（0~1），用来给一天之内的起伏
 */
export function humidityOf(weather: WeatherId, season: Season, usedRatio = 0, shelter = false): number {
  const base = WEATHER_HUM[weather] ?? HUMIDITY_DEFAULT;
  const idx = Math.max(0, Math.min(DIURNAL.length - 1, Math.round(usedRatio * (DIURNAL.length - 1))));
  const d = DIURNAL[idx] + SEASON_HUM[season];
  /* 室内：雨雪的湿气进不来（负数时也回一点，因为屋里总有水汽） */
  const v = shelter ? (base + d) * 0.25 + 55 * 0.7 : base + d;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export type HumBand = 'dry' | 'ok' | 'muggy';
export const humBand = (hum: number): HumBand => (hum < DRY_AT ? 'dry' : hum > MUGGY_AT ? 'muggy' : 'ok');
export const humLabel = (hum: number): string => {
  const b = humBand(hum);
  return b === 'dry' ? '干燥' : b === 'muggy' ? '闷湿' : '适宜';
};

/* ── 身体淋湿（雨雪天在外面的第二个后果） ── */
export const WET_MAX = 100;
export const wetGain = (weather: WeatherId, shelter: boolean, rainCloak = false): number => {
  if (shelter) return -22;                                   // 进屋/火堆：烘干
  const g = weather === 'storm' ? 26 : weather === 'rain' ? 18 : weather === 'snow' ? 12 : weather === 'fog' ? 6 : -8;
  if (g > 0 && rainCloak) return Math.round(g * 0.25);        // 雨衣：淋湿速度降到 1/4
  return g;
};
/** 淋湿的后果：体温掉得更快、更容易呼吸道感染（返回倍率与是否算"冷"） */
export const wetEffect = (wet: number): { tempMul: number; chill: boolean } =>
  ({ tempMul: wet >= 60 ? 1.6 : wet >= 30 ? 1.25 : 1, chill: wet >= 45 });

/* ── 病症链 ── */
export type CondId = 'heatstroke' | 'dehydration' | 'respiratory' | 'fungal';

export interface CondDef {
  id: CondId;
  name: string;
  icon: string;
  color: string;
  /** 数值惩罚（statMods 读它） */
  apMul: number;          // 体力（sta）上限倍率
  hitPenalty: number;     // 命中 −x
  /** 每"一段时间"（tickCond 的 stage 累加）掉血 */
  hpPerTick: number;
  /** 每 tick 多耗饥渴/水分的倍率 */
  thirstMul: number;
  /** 怎么好（写给玩家看的一句话） */
  cure: string;
  symptom: string;        // 人体页的症状文案（M31）
  hud: string;            // HUD 的一句话
}

export const CONDS: Record<CondId, CondDef> = {
  heatstroke: {
    id: 'heatstroke', name: '中暑', icon: '🥵', color: '#ef6f6f',
    apMul: 0.7, hitPenalty: 0.15, hpPerTick: 3, thirstMul: 1.6,
    cure: '回室内/火堆旁降温，喝水、歇一会儿',
    symptom: '太阳穴一跳一跳地疼，视野发白，衣服全黏在背上。',
    hud: '中暑：体力上限 −30%、命中 −15%，还在掉血',
  },
  dehydration: {
    id: 'dehydration', name: '脱水', icon: '💧', color: '#e0b45c',
    apMul: 0.85, hitPenalty: 0.06, hpPerTick: 1, thirstMul: 1.5,
    cure: '喝够水（干燥天喝水收益只有七成）',
    symptom: '嘴唇裂开，咽口水都疼，站起来眼前发黑。',
    hud: '脱水：水分消耗 ×1.5、喝水收益 −30%',
  },
  respiratory: {
    id: 'respiratory', name: '呼吸道感染', icon: '🤧', color: '#8ab4d8',
    apMul: 0.85, hitPenalty: 0.1, hpPerTick: 1, thirstMul: 1,
    cure: '进屋/火堆取暖 + 抗生素（拖久了会变成肺炎）',
    symptom: '喉咙像塞了棉花，咳出来的东西带颜色。',
    hud: '呼吸道感染：体力上限 −15%、命中 −10%',
  },
  fungal: {
    id: 'fungal', name: '真菌感染', icon: '🍄', color: '#b98ad8',
    apMul: 0.9, hitPenalty: 0.04, hpPerTick: 2, thirstMul: 1,
    cure: '抗真菌药（闷湿天最容易反复）',
    symptom: '指缝和腋下起了发痒的红斑，边缘一圈发白。',
    hud: '真菌感染：持续掉体力，伤口愈合变慢',
  },
};
export const COND_IDS = Object.keys(CONDS) as CondId[];

export interface CondInput {
  hum: number;
  temp: number;             // 体温 0~100
  /** 是否在室内/火堆旁（庇护） */
  shelter: boolean;
  /** 水分（thi）—— 低于 25 会加速脱水 */
  thi: number;
  /** 有雨衣/防水外套 */
  rainCloak?: boolean;
}

/** 该环境"应该"得哪些病（纯判定，不碰状态；tickCond 与 UI 提示都用它） */
export function condRisk(inp: CondInput): { gain: CondId[]; relief: CondId[] } {
  const band = humBand(inp.hum);
  const gain: CondId[] = [];
  const relief: CondId[] = [];
  /* 干燥：热 → 中暑；水分低 → 脱水。庇护所里不会中暑（有屋顶就不暴晒） */
  if (band === 'dry') {
    if (!inp.shelter && inp.temp >= HEAT_AT) gain.push('heatstroke');
    else relief.push('heatstroke');
    if (inp.thi < 25) gain.push('dehydration');
    else relief.push('dehydration');
  } else {
    relief.push('heatstroke');
    if (inp.thi >= 25) relief.push('dehydration');
  }
  /* 闷湿：凉/湿 → 呼吸道；热 → 真菌 */
  if (band === 'muggy') {
    if (inp.temp <= CHILL_AT && !inp.shelter) gain.push('respiratory');
    else if (inp.shelter) relief.push('respiratory');
    if (inp.temp >= HEAT_AT) gain.push('fungal');
    else if (inp.shelter) relief.push('fungal');
  } else {
    relief.push('respiratory', 'fungal');
    if (band === 'dry') relief.push('fungal');
  }
  return { gain, relief };
}

export interface CondState { id: CondId; since: number; stage: number }

/** 一次病症 tick：返回新的病症表 + 要写的日志（纯函数，调用方负责写进存档） */
export function tickCond(
  day: number, cur: CondState[], inp: CondInput, rng: () => number = Math.random,
): { next: CondState[]; hp: number; logs: string[] } {
  const { gain, relief } = condRisk(inp);
  const logs: string[] = [];
  let hp = 0;
  const has = (id: CondId) => cur.some(c => c.id === id);
  let next = cur.map(c => ({ ...c }));

  /* 进入：**带随机性**（不是必然得病），概率随风湿度偏离阈值的程度上升 ——
     "湿度高了容易得病"里的"容易"必须真的是概率，否则玩家会觉得"到 85 就必然感冒"。 */
  const dev = Math.max(0, (DRY_AT - inp.hum)) / DRY_AT + Math.max(0, (inp.hum - MUGGY_AT)) / (100 - MUGGY_AT);
  const p = Math.min(0.55, 0.12 + dev * 0.5) * (inp.shelter ? 0.4 : 1);
  for (const id of gain) {
    if (has(id)) continue;
    if (rng() < p) { next.push({ id, since: day, stage: 0 }); logs.push(`${CONDS[id].icon} 你得了${CONDS[id].name}：${CONDS[id].cure}。`); }
  }
  /* 持续：每 tick 累加 stage，重症按 hpPerTick 掉血 */
  next = next.map(c => {
    const st = { ...c, stage: c.stage + 1 };
    if (st.stage >= 2 && CONDS[c.id].hpPerTick > 0) hp -= CONDS[c.id].hpPerTick;
    return st;
  });
  /* 解除：环境对了 + 已经持续至少 2 段 → 消退（不会"刚好转就立刻好"，也不会赖着不走） */
  const keep: CondState[] = [];
  for (const c of next) {
    if (relief.indexOf(c.id) >= 0 && c.stage >= 2) { logs.push(`✅ ${CONDS[c.id].name}缓过来了。`); continue; }
    if (c.stage > 24) { logs.push(`⌛ ${CONDS[c.id].name}拖了太久，落下一点后遗症（体力上限没完全回来）。`); }
    keep.push(c);
  }
  return { next: keep, hp, logs };
}

/** 病症对属性的惩罚（statMods 合并用）：返回体力上限倍率与命中惩罚 */
export function condPenalty(conds: CondState[]): { apMul: number; hit: number } {
  let apMul = 1, hit = 0;
  for (const c of conds) {
    const d = CONDS[c.id];
    if (!d) continue;
    apMul *= d.apMul;
    hit += d.hitPenalty;
  }
  return { apMul, hit };
}

/* ── 湿度对"今天该不该生火/东西会不会坏"的副作用（低成本、高感知） ── */
/** 生火成功率：闷湿天点不着（干燥天反而好点） */
export const fireChance = (hum: number): number => (hum >= MUGGY_AT ? 0.55 : hum >= 70 ? 0.8 : 1);
/** 生鲜腐坏倍率：闷湿烂得快（与季节 rot 相乘） */
export const rotMulOf = (hum: number): number => (hum >= MUGGY_AT ? 1.35 : hum >= 70 ? 1.15 : hum < DRY_AT ? 0.85 : 1);
/** 干燥带来的水分流失倍率（与体温的 heatWaterMul 相乘） */
export const dryThirstMul = (hum: number, temp: number): number => {
  if (hum >= DRY_AT) return 1;
  const dry = (DRY_AT - hum) / DRY_AT;                   // 0~1
  const heat = temp >= HEAT_AT ? 1 : temp >= 50 ? 0.5 : 0; // 越热越明显
  return 1 + dry * (0.45 + heat * 0.6);
};

/** 面板/HUD 一行（HUD 给数值、症状文案在人体页） */
export function humLine(hum: number, wet: number): string {
  const b = humBand(hum);
  const parts = [`湿度 ${Math.round(hum)}%（${humLabel(hum)}）`];
  if (b === 'dry') parts.push('干燥：容易中暑/脱水，东西反而不容易坏');
  else if (b === 'muggy') parts.push('闷湿：容易呼吸道感染与真菌，生火也难');
  else parts.push('适宜：没有额外影响');
  if (wet >= 30) parts.push(`身上湿了 ${Math.round(wet)}%${wet >= 60 ? '（体温掉得更快）' : ''}`);
  return parts.join(' · ');
}

/* ── 天气预报（工作台道具：M30 讨论里用户点名要的"天气预报类的东西"） ── */
export type ForecastKind = 'clear' | 'wet' | 'cold' | 'heat' | 'fog';
export const forecastKind = (w: WeatherId): ForecastKind =>
  (w === 'rain' || w === 'storm' || w === 'snow') ? 'wet'
    : (w === 'cold') ? 'cold' : (w === 'heat') ? 'heat' : (w === 'fog') ? 'fog' : 'clear';
export const FORECAST_INFO: Record<ForecastKind, { label: string; icon: string; hint: string }> = {
  clear: { label: '晴好', icon: '☀️', hint: '适合出远门与生火' },
  wet: { label: '有雨雪', icon: '🌧️', hint: '能接水，但会淋湿、生火难' },
  cold: { label: '寒潮', icon: '🧊', hint: '体温掉得快，备好保暖与燃料' },
  heat: { label: '热浪', icon: '🔥', hint: '干燥 + 高温：小心中暑与脱水' },
  fog: { label: '起雾', icon: '🌫️', hint: '能见度差、遭遇率上升' },
};
/** 湿度预报：把未来几天的天气折成"该准备什么"（收音机/温度计那类道具读它） */
export function forecastHumidity(weathers: WeatherId[], season: Season): { hum: number; kind: ForecastKind; hint: string }[] {
  return weathers.map(w => {
    const hum = humidityOf(w, season, 0.5, false);
    const k = forecastKind(w);
    return { hum, kind: k, hint: FORECAST_INFO[k].hint };
  });
}
