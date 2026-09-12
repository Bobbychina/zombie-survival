/* M6 · 农业（会议 F02/C9）：地块 + 播种 + 生长 + 收获 + 留种 + 季节/天气影响。
   - 地块数 = 菜园等级（S.base.garden），等级 0 就没地
   - 生长天数 = 基准 ÷ 季节系数（env-core 的 growthDays），冬天户外停摆
   - 有决策点：① 种什么（快熟低产 / 慢熟高产）② 留不留种（留种少收一茬）
   - 温室（第二波）先不做，但冬天会明确告诉你"现在种不了"。 */
import { L } from '../main';
import { CROPS, CROP_LIST, SEASON_INFO, WEATHER, harvestYield, growthDays, rotDays } from './env-core';
import { envOf, seasonNow } from './env';

export interface Plot { crop: string; day: number }

export const plots = (): Plot[] => {
  const S = L.S as any;
  if (!Array.isArray(S.plots)) S.plots = [];
  return S.plots as Plot[];
};

/** 地块上限 = 菜园等级（每级 1 块，最高 3）；空地块用 {crop:'',day:0} 占位 */
export function plotSlots(): Plot[] {
  const S = L.S as any;
  const cap = Math.max(0, Math.min(3, S.base?.garden ?? 0));
  const p = plots();
  while (p.length < cap) p.push({ crop: '', day: 0 });
  if (p.length > cap) p.length = cap;
  return p;
}

export function seedCount(cropId: string): number {
  const c = CROPS[cropId];
  return c ? L.itemCount(c.seed) : 0;
}

/** 建设成本文案按真实成本生成。根因：这两处原来硬编码了「木 3 + 布 2 + 罐头 1」，
    后来 BASE_UP.garden 改成木 2/布 1/罐头 1，提示就一直在骗玩家（截图核对时发现的）。
    等级越高成本按 scaledCost 上浮，所以每次现算。 */
export function buildCostText(k: string): string {
  const S = L.S as any;
  const cost = (L.scaledCost?.(k, S.base?.[k] ?? 0) ?? {}) as Record<string, number>;
  return Object.keys(cost).map(c => L.itemName(c) + '×' + cost[c]).join(' + ');
}

/** 播一块地：消耗 1 份种子 */
export function plant(index: number, cropId: string): boolean {
  const S = L.S as any;
  const slots = plotSlots();
  const c = CROPS[cropId];
  if (!c) { L.toast('没有这种作物', '只能在蔬菜和麦子之间选。', 'bad'); return false; }
  if (!S.base?.garden) { L.toast('还没有菜园', '先去据点建设屋顶菜园（' + buildCostText('garden') + '）。', 'bad'); return false; }
  const p = slots[index];
  if (!p) return false;
  if (p.crop) { L.toast('这块地种着东西', '等收了再种。', 'bad'); return false; }
  if (L.itemCount(c.seed) < 1) { L.toast('没有种子', c.name + '要 ' + L.itemName(c.seed) + '，去农场/超市搜或找营地买。', 'bad'); return false; }
  const need = growthDays(cropId, seasonNow());
  if (!isFinite(need)) { L.toast('这个季节种不了', '冬天户外作物全部停摆——先靠采集和存货过冬。', 'bad'); return false; }
  L.takeItem(c.seed, 1);
  p.crop = cropId; p.day = 0;
  L.log(`🌱 你在第 ${index + 1} 块地播下${c.name}（${need} 天后可收，${SEASON_INFO[seasonNow()].name}季系数 ${SEASON_INFO[seasonNow()].crop}）。`, 'info');
  L.sfx('ui'); L.autosave(); L.render();
  return true;
}

/** 收一块地：keepSeed = 留种（少收一茬，但拿回 1 份种子） */
export function harvest(index: number, keepSeed = false): boolean {
  const p = plotSlots()[index];
  if (!p || !p.crop) { L.toast('这块地是空的', '先播种。', 'bad'); return false; }
  const c = CROPS[p.crop];
  const need = growthDays(p.crop, seasonNow());
  if (!isFinite(need) || (p.day || 0) < need) {
    const left = isFinite(need) ? Math.max(0, need - (p.day || 0)) : Infinity;
    L.toast('还没熟', isFinite(left) ? `还要 ${left} 天。` : '这个季节长不起来。', 'bad');
    return false;
  }
  const n = harvestYield(p.crop, seasonNow(), envOf().weather, keepSeed, Math.random);
  if (n === null || n <= 0) {
    p.crop = ''; p.day = 0;
    L.log(`🌾 ${c.name}这一茬绝收了（季节或天气太差）。`, 'danger');
    L.autosave(); L.render();
    return true;
  }
  L.grant(c.out, n);
  if (keepSeed) L.grant(c.seed, 1);
  // 生鲜腐坏天数按季节走（夏短冬长）：legacy 只在"没有记录"时初始化，所以这里先写死一个当季值
  if (L.ITEMS[c.out]?.fresh) (L.S as any).spoil[c.out] = rotDays(c.out, seasonNow(), L.ITEMS[c.out].fresh);
  L.log(`🧺 收了 ${n} 份${L.itemName(c.out)}${keepSeed ? '（留种：少收了 ' + c.keepSeedCost + ' 份，但拿回 1 份种子）' : ''}。`, 'success');
  p.crop = ''; p.day = 0;
  L.sfx('loot'); L.autosave(); L.render();
  return true;
}

/** 面板标题用的摘要 */
export function farmSummary(): string {
  const s = plotSlots();
  if (!s.length) return '还没有菜园（据点 → 建设 → 屋顶菜园：' + buildCostText('garden') + '）';
  const season = seasonNow();
  return s.map((p, i) => {
    if (!p.crop) return `地 ${i + 1}：空`;
    const c = CROPS[p.crop];
    const need = growthDays(p.crop, season);
    const left = isFinite(need) ? Math.max(0, need - (p.day || 0)) : Infinity;
    return `地 ${i + 1}：${c.icon}${c.name}${isFinite(left) ? (left <= 0 ? '（可收）' : `（还要 ${left} 天）`) : '（本季停摆）'}`;
  }).join(' · ') + ` · ${SEASON_INFO[season].icon}${SEASON_INFO[season].name}季系数 ${SEASON_INFO[season].crop} · 今日${WEATHER[envOf().weather].icon}${WEATHER[envOf().weather].name}作物×${WEATHER[envOf().weather].crop}`;
}

export const cropList = () => CROP_LIST.map(id => CROPS[id]);
