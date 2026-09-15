/* M40：QoL 第三批（地图窗内滚 / 字号跟随所有页签与沙盒 / 手机单指拖动 + 触控命中区）的回归测试。
   为什么要有这组：
   ① 地图格子的命中区规则（鼠标 24~28 / 触屏 30~34，且要按 zoom 折回本地像素）是"屏幕上是多大"的账，
      写错了在 125%/160% 下会莫名其妙变小 —— 这条在 M32.1 已经踩过一次（窗口被顶出视口）；
   ② "只有一个滚动容器""不再有 158px 写死常量""#view 也带 zoom"这几条是纯 CSS/结构约定，
      下一个人重构样式时最容易手滑，用源码断言钉住。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cellTargets, cardsPerScreen } from '../src/v4/ui-scale-core'

describe('M40 · 地图格子的命中区（屏幕上是多大）', () => {
  it('鼠标/触控板：24~28px（R4 定的命中区不变）', () => {
    expect(cellTargets(false, 1)).toEqual({ min: 24, max: 28 })
  })
  it('触屏：30~34px（手机单指点得准）', () => {
    expect(cellTargets(true, 1)).toEqual({ min: 30, max: 34 })
  })
  it('字号放大时按 zoom 折回本地像素 —— 屏幕上仍然是 24/30px', () => {
    expect(cellTargets(false, 1.6)).toEqual({ min: 15, max: 18 })   // 15×1.6=24、18×1.6=28.8
    expect(cellTargets(true, 1.6).min).toBe(19)                     // 19×1.6=30.4
    expect(cellTargets(true, 1.45).min * 1.45).toBeGreaterThanOrEqual(29.5)
  })
  it('zoom 是脏值（0 / NaN / 负数）时按 1 算，且下限永远 ≥10px（不许算出 0 或负数）', () => {
    expect(cellTargets(false, 0)).toEqual({ min: 24, max: 28 })
    expect(cellTargets(true, NaN as unknown as number)).toEqual({ min: 30, max: 34 })
    expect(cellTargets(true, -2).min).toBeGreaterThanOrEqual(10)
  })
  it('max 永远不小于 min（调用方用它们做 clamp）', () => {
    for (const z of [0.5, 1, 1.15, 1.6, 2.4]) {
      const t = cellTargets(true, z)
      expect(t.max).toBeGreaterThanOrEqual(t.min)
    }
  })
  it('大字模式卡片会变少（预期行为，别当成 bug）', () => {
    expect(cardsPerScreen(900, 300, 160)).toBeLessThan(cardsPerScreen(900, 300, 100))
  })
})

describe('M40 · 布局约定（源码断言）', () => {
  const css = readFileSync('src/styles/v4.css', 'utf8')
  /* 注释里解释历史可以提 158px，断言只看**规则**（把注释剥掉再查） */
  const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const world = readFileSync('src/v4/world-ui.ts', 'utf8')

  it('#view 也带字号倍率（背包/任务/制作等页签 + 折叠条以前完全不跟随）', () => {
    expect(css).toMatch(/#view[^{]*\{[^}]*zoom:var\(--fs/)
  })
  it('教程沙盒（#v4lab）同样跟随字号', () => {
    expect(css).toMatch(/#v4lab\{[^}]*zoom:var\(--fs/)
  })
  it('地图窗里只有 .mwbody 一个滚动容器；网格自己不再滚（158px 写死常量已删）', () => {
    expect(css).toMatch(/#v4mapwin #v4world \.wmapwrap\{overflow:visible;max-height:none\}/)
    /* 注释里解释历史可以提 158px，但**规则**里不许再用这个常量（它不随字号缩放，是那个 bug 的根） */
    expect(cssRules).not.toMatch(/max-height:calc\([^;}]*158px/)
    expect(css).toMatch(/#v4mapwin \.mwbody\{flex:1 1 auto/)
  })
  it('触屏媒体查询里的列宽带 !important（内联列宽压过普通规则，没它就永远不生效）', () => {
    expect(css).toMatch(/@media \(hover:none\), \(pointer:coarse\)/)
    expect(css).toMatch(/\.v4world \.wgrid\{grid-template-columns:repeat\(24,minmax\(26px,32px\)\)!important/)
    expect(css).toMatch(/touch-action:pan-x pan-y/)
  })
  it('world-ui：命中区规则走 ui-scale-core.cellTargets + 触屏判定', () => {
    expect(world).toContain('cellTargets(coarsePointer(), z)')
    expect(world).toContain("matchMedia('(hover:none), (pointer:coarse)')")
  })
  it('world-ui：可用高度按**卡片宿主**量（悬浮窗里的卡不能拿 #view 的高度算）', () => {
    expect(world).toContain('const hostBox = (card.parentElement || view).getBoundingClientRect()')
    expect(world).toContain('Math.min(viewBox.bottom, hostBox.bottom)')
  })
  it('world-ui：网格仍保留可缩的 1fr 内联列宽（窄容器不许横向溢出）', () => {
    expect(world).toContain("style=\"grid-template-columns:repeat(' + WORLD_W + ',1fr)\"")
  })
})
