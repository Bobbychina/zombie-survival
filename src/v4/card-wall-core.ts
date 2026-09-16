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
