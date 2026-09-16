/* M43：滚动位置保持（用户报障：「为啥每次行动后滚动会自动回到顶上，这不方便」）
   根因：legacy render() 每次都 `v.scrollTop = 0`，而每次搜刮/休整/制作都会 render。
   这里钉住三件事：① 同页签刷新保留偏移 ② 换页签回顶部 ③ 日志面板只在"本来就在底部"时才跟着滚。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { shouldStickToBottom, keepOffsets, KEEP_SELECTORS } from '../src/v4/scroll-keep'

const box = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({ scrollTop, scrollHeight, clientHeight })

describe('M43 · 日志面板：什么时候该自动跟到底部', () => {
  it('贴着底部 / 内容不够长 → 跟着滚（新日志永远看得见）', () => {
    expect(shouldStickToBottom(box(800, 1200, 400))).toBe(true)          // 正好在底部
    expect(shouldStickToBottom(box(790, 1200, 400))).toBe(true)          // 差 10px，算贴着
    expect(shouldStickToBottom(box(0, 300, 400))).toBe(true)             // 内容比容器短：本来就"在底部"
  })
  it('玩家往上翻看剧情 → 不跟着滚（不许被拽回底部）', () => {
    expect(shouldStickToBottom(box(100, 1200, 400))).toBe(false)
    expect(shouldStickToBottom(box(700, 1200, 400))).toBe(false)         // 差 100px > 48px 宽容带（一行半）
    expect(shouldStickToBottom(box(730, 1200, 400))).toBe(false)         // 差 70px，已经翻上去一段了
  })
  it('宽容带够"一行"（行高 30~40px 的面板：贴底判定不能被一行之差骗过去）', () => {
    expect(shouldStickToBottom(box(763, 1200, 400))).toBe(true)          // 差 37px：就是一行，仍算贴底
    expect(shouldStickToBottom(box(755, 1200, 400))).toBe(true)
  })
  it('宽容带可调；脏值一律当"不跟"（宁可不动也不要乱跳）', () => {
    expect(shouldStickToBottom(box(700, 1200, 400), 120)).toBe(true)
    expect(shouldStickToBottom(box(700, 1200, 400), 0)).toBe(false)
    expect(shouldStickToBottom(null)).toBe(false)
    expect(shouldStickToBottom(box(NaN as unknown as number, 1200, 400))).toBe(false)
    expect(shouldStickToBottom(box(0, NaN as unknown as number, 400))).toBe(false)
  })
})

describe('M43 · 偏移表：换页签归零、同页签保留', () => {
  const snap = { '#view': 412, '#log': 88, '#v4cards': 300 }
  it('同页签刷新：三个容器原样保留', () => {
    expect(keepOffsets(snap)).toEqual({ '#view': 412, '#log': 88, '#v4cards': 300 })
  })
  it('换页签：#view 归零（新页面从头看），其它容器不动', () => {
    expect(keepOffsets(snap, { resetView: true })).toEqual({ '#view': 0, '#log': 88, '#v4cards': 300 })
  })
  it('脏值/负数夹回 0，小数向下取整', () => {
    expect(keepOffsets({ '#view': -5, '#log': 3.9, '#v4cards': NaN as unknown as number })).toEqual({ '#view': 0, '#log': 3, '#v4cards': 0 })
    expect(keepOffsets({})).toEqual({})
  })
  it('需要保住的容器清单包含主区域、日志、卡片墙与地图窗（别再漏掉哪个）', () => {
    expect(KEEP_SELECTORS).toContain('#view')
    expect(KEEP_SELECTORS).toContain('#log')
    expect(KEEP_SELECTORS).toContain('#v4cards')
    expect(KEEP_SELECTORS).toContain('#v4mapwin .mwbody')
  })
})

describe('M43 · 接线（render 不许再无条件回顶）', () => {
  const legacy = readFileSync('src/legacy/game.ts', 'utf8')
  it('render() 里不再有 `v.scrollTop = 0`，改成快照 + 还原', () => {
    const body = legacy.slice(legacy.indexOf('function render(){'))
    const fn = body.slice(0, body.indexOf('\nfunction baseLevel'))
    expect(fn).not.toMatch(/v\.scrollTop\s*=\s*0/)
    expect(fn).toContain('const snap = snapshotScroll()')
    expect(fn).toContain('restoreScroll(keepOffsets(snap, { resetView: tabChanged })')
    expect(fn).toContain("v.dataset.tab = S.tab")
  })
  it('日志只在"本来就在底部"时才自动跟到底部', () => {
    const body = legacy.slice(legacy.indexOf('function log(msg, type){'))
    const fn = body.slice(0, body.indexOf('function clearLog'))
    expect(fn).toContain('const stick = shouldStickToBottom(box)')
    expect(fn).toContain('if(stick){')
  })
})
