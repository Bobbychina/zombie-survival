/* M37：通关 → 无尽模式那一段的回归测试（M51 重写过一次，见下）。
   M37 的原始版本：玩家实测报过「通关好结局之后，到了无尽模式你会直接死，然后地图变成了旧版」——
   当时的补丁是让 enterEndless() 清掉 S.over。
   M51（用户报障："通关后这个玩意是老版本的、整个界面都退回老版本，删掉"）把这条路彻底改了：
   **通关不再置 S.over**（over 是 v4 世界面板/移动/夜间结算的总闸，置上就等于把整屏交回旧版探索页），
   通关当场 = 清 over + 开 endless（winContinuePatch），旧版「城市地图」「本局已通关」整块删除。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resumeFromOver, winContinuePatch, endDayLabel, endGoalChip, ENDLESS_REVIVE_RATE } from '../src/v4/endless-core'

const S = (o: Partial<{ over: boolean; hp: number; hpMax: number; ap: number; apMax: number; endless: boolean }> = {}) =>
  ({ over: false, hp: 100, hpMax: 100, ap: 6, apMax: 6, endless: false, ...o })

describe('M37 · resumeFromOver：从"已结束"切回可玩状态', () => {
  it('over 清掉、血还在就不动血', () => {
    const s = S({ over: true, hp: 88 })
    const r = resumeFromOver(s)
    expect(r.revived).toBe(false)
    expect(s.over).toBe(false)
    expect(s.hp).toBe(88)
  })

  it('血为 0 → 救回三成，over 清掉', () => {
    const s = S({ over: true, hp: 0, hpMax: 120 })
    const r = resumeFromOver(s)
    expect(r.revived).toBe(true)
    expect(s.hp).toBe(Math.round(120 * ENDLESS_REVIVE_RATE))
    expect(s.hp).toBeGreaterThan(0)
    expect(s.over).toBe(false)
  })

  it('血上限很低也不会救成 0 血（Math.max(1, …)）', () => {
    const s = S({ over: true, hp: 0, hpMax: 2 })
    resumeFromOver(s)
    expect(s.hp).toBe(1)
  })

  it('行动力为 0 时补满；还有剩就不动它（不能白送 AP）', () => {
    const a = S({ over: true, hp: 50, ap: 0, apMax: 7 }); resumeFromOver(a)
    expect(a.ap).toBe(7)
    const b = S({ over: true, hp: 50, ap: 3, apMax: 7 }); resumeFromOver(b)
    expect(b.ap).toBe(3)
  })

  it('NaN / undefined 血值也按死亡处理（坏档别把玩家卡在 over 里）', () => {
    const s = S({ over: true, hp: NaN as unknown as number })
    expect(resumeFromOver(s).revived).toBe(true)
    expect(s.hp).toBeGreaterThan(0)
  })
})

describe('M51 · winContinuePatch：通关 = 无尽延续，不是"本局已结束"', () => {
  it('通关（血还在）→ over 清掉、endless 打开、血/行动力不动', () => {
    const s = S({ over: true, hp: 88, ap: 4 })
    const p = winContinuePatch(s)
    expect(p.over).toBe(false)
    expect(p.endless).toBe(true)
    expect(p.hp).toBe(88)
    expect(p.ap).toBe(4)
    expect(s.over).toBe(false)          // 原地也被清掉（调用方直接赋值回去）
  })

  it('老档停在"over 且血为 0"的半死状态 → 救回三成血、AP 补满', () => {
    const s = S({ over: true, hp: 0, hpMax: 80, ap: 0, apMax: 6 })
    const p = winContinuePatch(s)
    expect(p.hp).toBe(Math.round(80 * ENDLESS_REVIVE_RATE))
    expect(p.ap).toBe(6)
    expect(p.over).toBe(false)
    expect(p.endless).toBe(true)
  })

  it('已经通关过一次（endless 已开）也照样幂等', () => {
    const p = winContinuePatch(S({ endless: true }))
    expect(p).toEqual({ over: false, endless: true, hp: 100, ap: 6 })
  })
})

describe('M37 · 无尽模式的天数与目标牌', () => {
  it('普通局顶栏是 "天数 / 目标"', () => {
    expect(endDayLabel(12, false, 100)).toBe('12 / 100')
  })
  it('无尽局不再显示 "101 / 100"（看着像坏档）', () => {
    const t = endDayLabel(101, true, 100)
    expect(t).toBe('第 101 天 · 无尽')
    expect(t).not.toContain('/')
  })
  it('日历目标牌：普通局说"活到第 100 天"，无尽局说无尽', () => {
    expect(endGoalChip(false, 100)).toContain('活到第 100 天')
    expect(endGoalChip(true, 100)).toContain('无尽')
  })
})

describe('M51 · 旧版回退与旧版残留必须彻底没有', () => {
  const legacy = readFileSync('src/legacy/game.ts', 'utf8')
  const worldUi = readFileSync('src/v4/world-ui.ts', 'utf8')
  const css = readFileSync('src/styles/v4.css', 'utf8')
  const fn = (name: string) => {
    const body = legacy.slice(legacy.indexOf('function ' + name + '('))
    return body.slice(0, body.indexOf('\n}'))
  }

  it('通关路径不再把 over 置 true（rescueEnding / finalVictory 都走 winContinue）', () => {
    expect(fn('rescueEnding')).not.toContain('S.over = true')
    expect(fn('rescueEnding')).toContain('winContinue()')
    expect(fn('finalVictory')).toContain('winContinue()')
    expect(fn('winContinue')).toContain('winContinuePatch(')
  })

  it('旧版「本局已通关」文案整条删除（用户截图里那一件）', () => {
    // 断言的是代码里的那条 return，不是注释里引用它做说明的那几个字
    expect(legacy).not.toContain("return '本局已通关'")
  })

  it('旧版「城市地图」渲染器（renderMap / mapClick / goHome）整块删除，探索页不再拼它', () => {
    expect(legacy).not.toContain('function renderMap(')
    expect(legacy).not.toContain('function mapClick(')
    expect(legacy).not.toContain('function goHome(')
    expect(legacy).not.toContain('h += renderMap()')
    expect(legacy).not.toContain('城市地图 <span class="badge">')
    for (const name of ['renderMap', 'mapClick', 'goHome']) {
      expect(legacy).not.toContain(', ' + name + ',')      // window 导出表里也不能留
    }
  })

  it('「进入无尽模式」按钮（旧界面的一部分）都删了：通关即无尽，没有第二个入口', () => {
    expect(legacy).not.toContain('进入无尽模式</button>')
  })

  it('老档读档归一：won=true 的档一律按无尽延续走', () => {
    expect(legacy).toContain('if(out.flags.won) out.flags.endless = true;')
  })

  it('over 状态下 v4 自己画结束卡，不把探索页交回 legacy', () => {
    expect(worldUi).toContain('function mountOverCard(')
    expect(worldUi).toContain("mountOverCard(view)")
    expect(worldUi).toContain("id = 'v4over'")
    expect(css).toContain('#view.v4-over > :not(#v4over):not(#v4world){display:none}')
  })
})

describe('M37 · 接线（legacy 只 import，不重复实现）', () => {
  const legacy = readFileSync('src/legacy/game.ts', 'utf8')
  it('enterEndless() 仍然通过 resumeFromOver 清 over（老档救援 / 探针入口）', () => {
    const body = legacy.slice(legacy.indexOf('function enterEndless()'))
    const fn = body.slice(0, body.indexOf('\n}'))
    expect(fn).toContain('resumeFromOver(S)')
  })
  it('顶栏/日历目标牌都用 endless-core 的公式', () => {
    expect(legacy).toContain('endDayLabel(S.day, !!S.flags.endless, GOAL_DAY)')
    expect(legacy).toContain('endGoalChip(')
  })
})
