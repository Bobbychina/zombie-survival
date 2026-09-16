/* M6 · 季节/天气/体温的**运行时**：每天翻日时掷天气、走体温、接雨水、菜园生长、季节腐坏修正。
   纯数值一律来自 env-core（与模拟脚本同源）。 */
import seedrandom from 'seedrandom';
import { L } from '../main';
import {
  CROPS, CROP_LIST, RAIN_CAP_PER_DAY, SEASON_INFO, TEMP_COMFORT, TEMP_COMFORT_C, TEMP_LOW, TEMP_LOW_C, TEMP_HIGH_C, WEATHER, WEATHER_LIST,
  growthDays, heatWaterMul, rainWaterToday, rotDays, rollWeather, seasonOf, tempDrift, tempPenalty, tempState, tempStateText, tempText,
  type Season, type WeatherId,
} from './env-core';

/** S.env：季节 + 天气 + 体温（会议 C14：S/W 合并成一个对象，天气只存今天/明天） */
export interface EnvState {
  weather: WeatherId;
  tomorrow: WeatherId;
  temp: number;
  rainToday: number;      // 今天已接到的雨水（污水）
  coldTier: number;       // 连续低温暴露的计数（用于提示，不参与掉血）
}

export const envOf = (): EnvState => {
  const S = L.S as any;
  if (!S.env || typeof S.env !== 'object') {
    S.env = { weather: 'clear', tomorrow: 'cloudy', temp: TEMP_COMFORT, rainToday: 0, coldTier: 0 } as EnvState;
  }
  const e = S.env as EnvState;
  if (!WEATHER[e.weather]) e.weather = 'clear';
  if (!WEATHER[e.tomorrow]) e.tomorrow = 'cloudy';
  if (typeof e.temp !== 'number' || !isFinite(e.temp)) e.temp = TEMP_COMFORT;
  if (typeof e.rainToday !== 'number') e.rainToday = 0;
  if (typeof e.coldTier !== 'number') e.coldTier = 0;
  return e;
};

export const seasonNow = (): Season => seasonOf(L.S.day);
export const weatherNow = (): WeatherId => envOf().weather;
/** 天气对当前行动的影响（UI 与结算都读它） */
export const weatherFx = () => WEATHER[envOf().weather];
/** 体温惩罚：AP 上限与命中 */
export const tempFxNow = () => tempPenalty(envOf().temp);

/** 玩家现在是不是在"室内/火堆旁"（安全屋、掩体类 POI、有火堆的营地都算） */
export function sheltered(): boolean {
  const S = L.S as any;
  const sw = S.world;
  if (!sw) return false;
  const key = sw.cur.x + ',' + sw.cur.y;
  const w = (window as any).V4?.worldgen?.generateWorld?.(sw.seed);
  const home = w && sw.cur.x === w.home.x && sw.cur.y === w.home.y;
  if (home) return true;
  const b = w?.blocks?.[key];
  const poi = b?.poi;
  return !!poi && ['bunker', 'prison', 'military', 'tunnel', 'church', 'camp'].includes(poi);
}

/** 体温漂移：白天每次行动/赶路、夜里睡觉都会走一次（夜里额外 −2） */
export function tempTick(units = 1, night = false) {
  const S = L.S as any;
  const e = envOf();
  const d = tempDrift({ season: seasonNow(), weather: e.weather, shelter: sheltered(), night });
  e.temp = Math.max(0, Math.min(100, e.temp + d * units));
  if (e.temp < TEMP_LOW) e.coldTier++; else e.coldTier = 0;
  void S;
  return e.temp;
}

/** 翻日：掷天气、接雨水、菜园生长、季节腐坏修正、体温过夜结算 */
export function envDayTick() {
  const S = L.S as any;
  const e = envOf();
  const day = S.day;
  const season = seasonOf(day);
  const rng = seedrandom(`${S.world?.seed ?? 'ember-01'}:weather:${day}`);
  e.weather = e.tomorrow && WEATHER[e.tomorrow] ? e.tomorrow : rollWeather(rng, season);
  e.tomorrow = rollWeather(seedrandom(`${S.world?.seed ?? 'ember-01'}:weather:${day + 1}`), seasonOf(day + 1));
  e.rainToday = 0;

  const fx = WEATHER[e.weather];
  L.log(`${SEASON_INFO[season].icon} 第 ${day} 天 · ${SEASON_INFO[season].name}季 · ${fx.icon}${fx.name}${fx.desc ? '：' + fx.desc : ''}`, 'info');
  if (season === 'winter' && L.S.day >= 91) L.log('❄️ 冬天到了：户外作物全部停摆，采集几乎归零，体温掉得很快。', 'danger');

  // 接雨水（只有雨/雪天有，且每天有上限）：拿到的是污水，要煮沸才能喝
  const rain = rainWaterToday(e.weather);
  if (rain > 0) {
    e.rainToday = Math.min(RAIN_CAP_PER_DAY, rain);
    L.addItem('dirty', e.rainToday, true);
    L.log(`💧 ${fx.icon}${fx.name}：接水器攒到 ${e.rainToday} 份污水（煮沸后能喝，雨天每天最多 ${RAIN_CAP_PER_DAY} 份）。`, 'loot');
  }

  // 过夜体温结算（火堆/室内完全对抗）
  tempTick(1, true);
  const p = tempPenalty(e.temp);
  if (p.note) L.log(p.note, 'danger');
  if (e.temp >= TEMP_LOW && L.S.day > 1 && season === 'winter') L.log('🔥 屋里有火：这一夜没被冻着。', 'dim');
}

/** 菜园生长（每天调用一次）：把每块地的进度 +1，成熟了留在那里等玩家收 */
export function farmGrow() {
  const S = L.S as any;
  const plots: { crop: string; day: number; seed?: boolean }[] = Array.isArray(S.plots) ? S.plots : (S.plots = []);
  const season = seasonNow();
  const fx = WEATHER[envOf().weather];
  for (const p of plots) {
    if (!p || !p.crop || !CROPS[p.crop]) continue;
    const need = growthDays(p.crop, season);
    if (!isFinite(need)) continue;                                  // 冬天户外：冻住不长
    const mul = fx.crop > 0 ? 1 : 0;                                // 暴雨/热浪/雪/寒潮：当天不长
    if (mul > 0) p.day = Math.min(need, (p.day || 0) + 1);
  }
  void S;
}

/** 面板/UI 用：把当天环境写成一行 */
export function envLine(): string {
  const e = envOf(), season = seasonNow(), fx = WEATHER[e.weather];
  const p = tempPenalty(e.temp);
  /* M52：体温对外一律摄氏度（内部 0~100 的"体温点"只在 env-core 里换算） */
  const tempTxt = tempStateText(e.temp, true);
  /* M30：湿度/病症那一行由 survival.ts 追加（这里不 import 它，避免 env ↔ survival 循环依赖）。
     用 try/catch 兜住：这一行要是挂了，不能把整块天气 HUD（乃至世界地图挂载）一起带走。 */
  let sv = '';
  try {
    const s = (typeof window !== 'undefined' ? (window as any).V4Survival : null);
    if (s && typeof s.survivalLine === 'function') sv = String(s.survivalLine() || '');
  } catch { sv = ''; }
  return `${SEASON_INFO[season].icon}${SEASON_INFO[season].name}季 · ${fx.icon}${fx.name} · 体温 ${tempText(e.temp)}（${tempTxt}）` +
    (p.note ? ' ⚠️' : '') + (sv ? ' · ' + sv : '') + ` · 明日 ${WEATHER[e.tomorrow].icon}${WEATHER[e.tomorrow].name}`;
}

/** HUD 用：体温条 + 季节天气（会议 R11：最小 HUD，不动地图面板结构） */
export function envChips(): string {
  const e = envOf(), season = seasonNow(), fx = WEATHER[e.weather];
  const cls = tempState(e.temp) === 'low' ? 'cold' : tempState(e.temp) === 'high' ? 'heavy' : '';
  /* M30：湿度/淋湿/病症的 chips 由 main.ts 追加（见 paintEnv） */
  return `<span class="chip ${cls}" title="${envLine()}">${SEASON_INFO[season].icon}${SEASON_INFO[season].name} ${fx.icon}${fx.name}</span>` +
    `<span class="chip ${cls}" title="体温：正常在 ${TEMP_COMFORT_C.toFixed(1)}℃ 左右；火堆/室内可回，低于 ${TEMP_LOW_C.toFixed(1)}℃ 会掉一档行动力与命中，高于 ${TEMP_HIGH_C.toFixed(1)}℃ 水分流失加快">🌡️ <b>${tempText(e.temp)}</b></span>`;
}

/** 高温时水分流失更快（挂到 tickVitals 之后的修正上） */
export function heatDrain() {
  const e = envOf();
  const mul = heatWaterMul(e.temp);
  if (mul > 1) {
    const S = L.S as any;
    S.thi = Math.max(0, S.thi - 3 * (mul - 1));
  }
}

/* M52：摄氏口径（tempText/tempDeltaText/tempState*）也一起转出去 —— 探针与内联 onclick 只认 window 上的名字，
   旧写法是各处把原始体温点自己四舍五入后打印，现在统一从这里取。 */
export {
  tempPenalty, tempText, tempDeltaText, tempState, tempStateText,
  TEMP_LOW, TEMP_HIGH, TEMP_COMFORT, TEMP_LOW_C, TEMP_HIGH_C, TEMP_COMFORT_C,
} from './env-core';
export const allCrops = () => CROP_LIST.map(id => CROPS[id]);
export const rotFor = (itemId: string, base = 4) => rotDays(itemId, seasonNow(), base);
export { WEATHER, WEATHER_LIST };
