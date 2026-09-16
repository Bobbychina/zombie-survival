/* M42：账号库那份"用旧密钥写的"副本不再刷屏（用户报障：「什么鬼」+ 满屏 ⚠️ 账号库里那份存档解不开）
   为什么会发生：account-vault 里有个 15 秒一次的预热循环，每轮对每个槽 hydrate 一次；
   那份副本是用**旧密钥**写的（换过浏览器 / 清过站点数据），于是每 15 秒甩一行警告 —— 挂机十分钟四十行。
   本组测的是"解不开时的策略"与接线（不许再回到"每次都喊"）。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unreadablePolicy, unreadableHint } from '../src/v4/account-vault-core'

describe('M42 · 账号库副本解不开时的策略', () => {
  it('第一次：警告一次；有兜底明文时顺手重建', () => {
    expect(unreadablePolicy({ warned: false, hasFallback: false })).toEqual({ warn: true, retry: false, heal: false })
    expect(unreadablePolicy({ warned: false, hasFallback: true })).toEqual({ warn: true, retry: false, heal: true })
  })
  it('已经警告过：不再警告、也不再重试（这就是"每 15 秒一条"的根治）', () => {
    expect(unreadablePolicy({ warned: true, hasFallback: false })).toEqual({ warn: false, retry: false, heal: false })
    expect(unreadablePolicy({ warned: true, hasFallback: true })).toEqual({ warn: false, retry: false, heal: true })
  })
  it('警告文案要说清"进度没事"（玩家第一反应是"我的档没了？"）', () => {
    expect(unreadableHint(false)).toContain('本地进度不受影响')
    expect(unreadableHint(true)).toContain('重建')
    expect(unreadableHint(true)).toContain('本地进度')
  })
})

describe('M42 · 接线（别再回到"每轮预热都喊一次"）', () => {
  const src = readFileSync('src/v4/account-vault.ts', 'utf8')
  it('解不开的槽会被记住，后续 hydrate 直接返回（不重复解密、不重复刷日志）', () => {
    expect(src).toContain('const badSlots = new Set<string>()')
    expect(src).toContain('if (badSlots.has(sk)) return null')
    expect(src).toContain('unreadablePolicy({ warned: badSlots.has(sk)')
  })
  it('15 秒预热与初始化都带上"当前进度"当兜底（自愈）', () => {
    expect(src).toContain('warmUp(\'zombie-survival\', liveSaveObj())')
    expect(src).toContain('function liveSaveObj()')
    expect(src).toContain('sealMainSlot = (game: string, fallback?: unknown)')
  })
  it('自愈会重建副本并把这一槽从"解不开"名单里放出来', () => {
    expect(src).toContain('async function resealWith(')
    expect(src).toContain('badSlots.delete(slotKeyFor(game, slot))')
    expect(src).toContain('账号库存档已用当前进度重建')
  })
})
