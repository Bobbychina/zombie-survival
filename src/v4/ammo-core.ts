/**
 * M25 弹药口径与穿透（参考《逃离塔科夫》）——纯逻辑层，不碰 DOM、不读存档。
 *
 * 设计取舍：口径（cal）挂在**武器**上，弹种（item）挂在**背包**里，两者用 cal 关联。
 * 一个口径可以有好几种弹（FMJ / 穿甲 / 独头…），伤害倍率 dmgMul 与穿透等级 pen 各不相同：
 *   - 打无甲目标：高伤低穿的弹更划算（穿甲弹 dmgMul 低，纯亏）
 *   - 打装甲目标：pen < armor 会被挡下大部分伤害（penMul 最低压到 15%）
 * 这条规则同时被 legacy 战斗（game.ts）和 v4 引擎（combat.ts 的 PlayerProfile.pen）使用，
 * 所以算法必须留在这里，避免两套战斗算出两个数。
 */

export interface CaliberDef { n: string; short: string }

/** 口径表：只放当前版本真的做了武器的口径 */
export const CALIBERS: Record<string, CaliberDef> = {
  c9:   { n: '9×19mm',  short: '9mm' },
  c12:  { n: '12 号',   short: '12G' },
  c556: { n: '5.56×45', short: '5.56' },
  c762: { n: '7.62×39', short: '7.62' },
  c308: { n: '7.62×51', short: '7.62N' },
};

export interface AmmoDef { id: string; cal: string; pen: number; dmgMul: number; n?: string }

/** 某口径在背包里有哪些弹（按穿透从低到高排序） */
export function ammoOf(items: Record<string, { t?: string; cal?: string; pen?: number; dmgMul?: number }>, cal: string): AmmoDef[] {
  const out: AmmoDef[] = [];
  for (const id in items) {
    const it = items[id];
    if (it.t !== 'ammo' || it.cal !== cal) continue;
    out.push({ id, cal, pen: it.pen || 0, dmgMul: it.dmgMul || 1 });
  }
  return out.sort((a, b) => a.pen - b.pen);
}

/** 全部口径的弹种表（背包/商店 UI 用） */
export function ammoTable(items: Record<string, { t?: string; cal?: string; pen?: number; dmgMul?: number }>): Record<string, AmmoDef[]> {
  const out: Record<string, AmmoDef[]> = {};
  for (const cal in CALIBERS) out[cal] = ammoOf(items, cal);
  return out;
}

/**
 * 当前给这个口径装的是哪种弹：玩家在「弹药」里选过就用选的，否则自动挑**穿透最高且有货**的。
 * @param inv 背包 {itemId: 数量}
 * @param load 玩家指定 {cal: itemId}
 * @param list ammoOf 的结果（按 pen 升序）
 */
export function pickLoadedAmmo(list: AmmoDef[], inv: Record<string, number>, load: Record<string, string> | undefined, cal: string): string | null {
  if (!list.length) return null;
  const pick = load && load[cal];
  if (pick && (inv[pick] || 0) > 0) return pick;
  for (let i = list.length - 1; i >= 0; i--) { if ((inv[list[i].id] || 0) > 0) return list[i].id; }
  return list[0] ? list[0].id : null;         // 全空也给个名字，好写进 UI
}

/** 穿透结算：pen ≥ armor 才算"打得动"；差得越多减伤越狠（装甲丧尸 armor 5、暴君 4） */
export function penMul(pen: number, armor: number): number {
  if (!armor) return 1;
  if (pen >= armor) return 1;
  return Math.max(0.15, 1 - (armor - pen) * 0.18);
}

/** 杂牌弹药（旧版伪 id "ammo"）的兜底弹种：9mm FMJ —— 与 M25 存档迁移同一个折算口径 */
export const GENERIC_AMMO = 'a9_fmj';

/**
 * M32b：旧版只有一个笼统的弹药池，掉落/委托/商人给的都是伪 id `ammo`，`grant()` 把它加到 `S.ammo`
 * ——而 S.ammo 从 M25 起只是"当前装填弹种发数"的**镜像**（开一枪就被 `ammoCount()` 覆写），
 * 于是"商人卖的子弹买了等于吞材料"。所以任何来源的 `ammo` 必须先折成**真弹**：
 * 优先手上这把枪的口径（捡到的补给是你能用的），没枪就 9mm FMJ。
 * @param items legacy 的 ITEMS 表（口径挂在物品上）
 * @param cal 当前武器口径（可空）
 */
export function resolveAmmoId(
  id: string,
  items: Record<string, { t?: string; cal?: string; pen?: number; dmgMul?: number }>,
  cal?: string | null,
): string {
  if (id !== 'ammo') return id;
  const list = cal ? ammoOf(items, cal) : [];
  return list.length ? list[0].id : GENERIC_AMMO;   // ammoOf 按穿透升序 → 取该口径最便宜的那种
}

/** 弹种的中文短名（"9mm 穿甲弹" → "穿甲弹"），HUD 一行放得下 */
export function ammoShortName(name: string): string {
  return name.split(' ').pop() || name;
}

/**
 * M39：老档的"笼统弹药池"该不该折进背包？
 *
 * 为什么要有这条规则：`sanitizeSave` 一直把 `save.ammo > 0` 当成"旧版弹药池"折进 `inv.a9_fmj`，
 * 但 M32b 之后 `S.ammo` 的含义变了 —— 它是"当前装填弹种发数"的**镜像**（`syncAmmo()` 每次背包变动重算），
 * 存档里天然是正数。于是每读一次档就白送一份弹药：实测刷新页面 100 → 200 → 400，等于无限子弹。
 *
 * 判据（两条都要满足才算老档）：① 存档里没有口径信息（`load` 空）② 背包里一件弹药物品都没有。
 * 真老档（M25 之前）只有 `S.ammo` 这个池子，这两条都成立；M32b 之后的档至少有一条不成立。
 *
 * @returns 要额外加进 `inv.a9_fmj` 的发数（0 = 不折算）
 */
export function legacyAmmoFold(
  ammo: number,
  load: Record<string, unknown> | undefined,
  inv: Record<string, number> | undefined,
  items: Record<string, { t?: string } | undefined>,
): number {
  const pool = Math.max(0, Math.floor(Number(ammo) || 0));
  const junk = Math.max(0, Math.floor(Number((inv || {})['ammo']) || 0));
  if (pool <= 0 && junk <= 0) return 0;
  const hasCaliberInfo = !!load && Object.keys(load).length > 0;
  const hasRealAmmo = !!inv && Object.keys(inv).some(id => items[id]?.t === 'ammo');
  if (hasCaliberInfo || hasRealAmmo) return 0;
  return pool + junk;
}
