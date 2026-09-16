/** M45：探索页 legacy 节点的「认领计划」——纯逻辑（DOM 侧只按计划执行，方便单测）。
 *
 *  用户报障「有重复的」的根因：legacy 的 `.sect-title` 会连带把紧随其后的 `.card`/`.grid`
 *  当成自己的正文认领，但那份 `.card` **同时也在待认领名单里**（名单是认领前拍的快照），
 *  于是它被包装第二遍 —— 标题退化成「📋 + 正文前 12 字」，日历整块因此在界面上出现两次。
 *  修法：认领计划里把"已经被上一张卡当正文领走"的节点标成 skip，一个节点永远只被认领一次。 */

/** 节点类型：skip＝不参与（卡片墙/地图卡/工具条等宿主节点）；title＝`.sect-title`；
    body＝`.card`/`.grid`（可能被前一个 title 认领成正文）；other＝裸节点，自己就是内容 */
export type LegacyKind = 'skip' | 'title' | 'body' | 'other'

export type ClaimStep =
  | { i: number; act: 'skip' }
  | { i: number; act: 'title'; body: number | null }   // body=null → 光杆标题，包成只有标题的卡
  | { i: number; act: 'bare' }

/** 认领计划：保证**每个非 skip 节点恰好被认领一次**（title 抢走的下一个 body 不再单独成卡） */
export function claimPlan(kinds: LegacyKind[]): ClaimStep[] {
  const out: ClaimStep[] = []
  const taken = new Set<number>()
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]
    if (k === 'skip') { out.push({ i, act: 'skip' }); continue }
    if (taken.has(i)) { out.push({ i, act: 'skip' }); continue }   // ← 修复点：已被当正文领走
    if (k === 'title') {
      const nxt = kinds[i + 1]
      if (nxt === 'body') { taken.add(i + 1); out.push({ i, act: 'title', body: i + 1 }) }
      else out.push({ i, act: 'title', body: null })
      continue
    }
    out.push({ i, act: 'bare' })
  }
  return out
}

/** 认不出身份的裸节点的兜底标题（`legacyTitleOf` 的最后一档）：空白压平后取前 12 字 */
export function fallbackTitle(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim().slice(0, 12)
  return t ? '📋 ' + t : '📋 更多'
}

/* ── M53：其它页签的「分段」逻辑（P3 视觉统一：技能/制作/任务/统计… 也走卡片语言） ── */

export interface SectionGroup {
  /** `.sect-title` 的下标 */
  title: number;
  /** 这一段的正文（标题之后、下一个标题之前的散件；跳过 skip 宿主节点，如地图卡/卡片墙） */
  body: number[];
}

/** 按 `.sect-title` 把一页切段：标题 + 它后面的所有散件（到下个标题为止）。
 *
 *  为什么不是"标题 + 紧随的那一个 .card"：各页签的分段形状并不统一 ——
 *  背包是「标题 / 提示 p / 弹药 .card」，制作页是「标题 / 提示 p / 配方 .grid」，统计页是「标题 / .grid / …」。
 *  按"下一个标题"切段才不挑页面：一段 = 一张卡，正文是那一坨。
 *  标题之前的内容（人体页那张 v4 卡、图鉴的标签行…）不归任何段，原地不动。 */
export function sectionGroups(kinds: LegacyKind[]): SectionGroup[] {
  const out: SectionGroup[] = []
  let cur: SectionGroup | null = null
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]
    if (k === 'title') {
      if (cur) out.push(cur)
      cur = { title: i, body: [] }
      continue
    }
    if (k === 'skip') continue;              // 宿主节点（#v4world / #v4tools / 卡片墙）永远不搬
    if (cur) cur.body.push(i);               // 标题之后的散件都算这一段的正文
  }
  if (cur) out.push(cur)
  return out
}

/** 一段正文里"没有任何内容"（只有空白/空节点）＝ 不值得包一张空卡 */
export function bodyIsEmpty(texts: string[]): boolean {
  return texts.join('').replace(/\s+/g, '').length === 0
}

