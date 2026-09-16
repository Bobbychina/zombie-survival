/* M52：体温对外必须是摄氏度（用户：「体温改成摄氏度（50-100 的体温好诡异）」）。
   内部仍是 0~100 的"体温点"（50 = 舒适）—— 天气/季节/下水/淋湿的漂移量与两条惩罚阈值都按它标定，
   换内部单位要重调整套数值并迁存档；所以**只在 env-core 里换算一次**，UI 一律走 tempText()。
   这组测试钉两件事：① 换算本身（含坏值/越界）② 界面不许再拿原始体温点直接渲染。 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import {
  TEMP_COMFORT, TEMP_LOW, TEMP_HIGH, TEMP_COMFORT_C, TEMP_LOW_C, TEMP_HIGH_C,
  tempC, tempDeltaText, tempPenalty, tempState, tempStateText, tempText,
} from '../src/v4/env-core'

describe('M52 · 体温点 → 摄氏度', () => {
  it('50 点 = 37.0℃（正常体温），0 点 = 34.0℃、100 点 = 40.0℃', () => {
    expect(tempC(50)).toBe(37)
    expect(tempC(0)).toBe(34)
    expect(tempC(100)).toBe(40)
  })

  it('两条阈值换算成人话：低于 35.8℃ 扣一档、高于 38.8℃ 掉水更快', () => {
    expect(TEMP_COMFORT_C).toBe(37)
    expect(TEMP_LOW_C).toBe(35.8)
    expect(TEMP_HIGH_C).toBe(38.8)
    expect(tempC(TEMP_LOW)).toBe(35.8)
    expect(tempC(TEMP_HIGH)).toBe(38.8)
  })

  it('保留一位小数，且不会显示成 37℃/50 这种半成品', () => {
    expect(tempText(TEMP_COMFORT)).toBe('37.0℃')
    expect(tempText(TEMP_LOW)).toBe('35.8℃')
    expect(tempText(68)).toBe('38.1℃')          // 病症入口阈值（survival-core HEAT_AT）
    expect(tempText(TEMP_COMFORT)).toMatch(/^\d+\.\d℃$/)
  })

  it('坏档 / 越界值不许把界面变成 NaN℃ 或 60℃', () => {
    expect(tempC(NaN)).toBe(37)
    expect(tempC(undefined as unknown as number)).toBe(37)
    expect(tempText(-999)).toBe('34.0℃')
    expect(tempText(9999)).toBe('40.0℃')
    expect(tempText(NaN)).not.toContain('NaN')
  })

  it('变化量也按摄氏说：内部 -6 点 = 下水一格的 -0.4℃', () => {
    expect(tempDeltaText(-6)).toBe('-0.4℃')
    expect(tempDeltaText(6)).toBe('+0.4℃')
    expect(tempDeltaText(0)).toBe('0.0℃')
    expect(tempDeltaText(NaN)).toBe('0.0℃')
  })

  it('档位判定只有一处，长句/短词共用', () => {
    expect(tempState(TEMP_LOW - 1)).toBe('low')
    expect(tempState(TEMP_LOW)).toBe('ok')
    expect(tempState(TEMP_HIGH)).toBe('ok')
    expect(tempState(TEMP_HIGH + 1)).toBe('high')
    expect(tempStateText(TEMP_LOW - 1)).toBe('偏低')
    expect(tempStateText(TEMP_LOW - 1, true)).toContain('行动力')
    expect(tempStateText(TEMP_HIGH + 1, true)).toContain('水分')
    expect(tempStateText(TEMP_COMFORT)).toBe('正常')
  })

  it('惩罚提示里带的是℃读数，不是内部刻度', () => {
    const cold = tempPenalty(TEMP_LOW - 1).note || ''
    const hot = tempPenalty(TEMP_HIGH + 1).note || ''
    expect(cold).toContain('℃')
    expect(cold).toContain('35.8')
    expect(hot).toContain('38.8')
    expect(cold).not.toMatch(/体温 2\d(?!\d*℃)/)     // 旧版会把 29 印出来
  })
})

describe('M52 · 接线：界面只能通过 env-core 换算', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  const v4 = readdirSync('src/v4').filter((f) => f.endsWith('.ts')).map((f) => ['src/v4/' + f, read('src/v4/' + f)] as const)
  /* 温度换算只允许出现在 env-core（唯一数值表）里 */
  const converters = v4.filter(([, src]) => src.includes('TEMP_C_PER_UNIT')).map(([p]) => p)

  it('摄氏换算只在 env-core 一处', () => {
    expect(converters).toEqual(['src/v4/env-core.ts'])
  })

  it('没有哪一处还拿原始体温点直接渲染（Math.round(e.temp) / env.temp）', () => {
    const bad: string[] = []
    for (const [p, src] of v4) {
      if (/Math\.round\(\s*(e|env|envOf\(\))\s*\.\s*temp\s*\)/.test(src)) bad.push(p)
      if (/\$\{Math\.round\(\s*e\.temp\s*\)\}/.test(src)) bad.push(p)
    }
    expect(bad).toEqual([])
  })

  it('环境行 / 人体页 / 下水日志都用了摄氏口径', () => {
    expect(read('src/v4/env.ts')).toContain('tempText(e.temp)')
    expect(read('src/v4/env.ts')).toContain('低于 ${TEMP_LOW_C.toFixed(1)}℃')
    expect(read('src/v4/medical.ts')).toContain('tempText(e.temp)')
    expect(read('src/v4/water.ts')).toContain('tempDeltaText(tempLoss)')
  })
})
