/* M39：QoL 第二批的回归测试
   ① 商人批量购买（buyPlan：材料 / 今日库存 / 99 份上限三条约束 + 人话原因）
   ② 口令加密的存档导出/导入（save-port-core：往返、口令错、文本被改、头部校验、体量/预览/文件名）
   ③ 多份备份历史（backup-core：要不要存、轮转留哪几份、标签、坏数据兜底）
   加密测试统一用 iter=1000（真机 15 万次），避免测试套件被 PBKDF2 拖慢。 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buyPlan, shopPrice } from '../src/v4/shop-core'
import {
  exportSaveText, importSaveText, parsePortText, portSummary, passphraseIssue, passphraseWeak,
  portSizeKb, portFileName, PORT_MAGIC, PORT_MIN_PW,
} from '../src/v4/save-port-core'
import {
  BACKUP_SLOTS, SAME_DAY_KEEP, MIN_GAP_MS, MAX_SNAPSHOT_BYTES, snapshotMeta, utf8Len, shouldSnapshot,
  backupKey, rotateBackups, relativeTime, backupLabel, findBackup, parseBackupList, type BackupEntry,
} from '../src/v4/backup-core'

const ITER = 1000
const save = (o: Record<string, unknown> = {}) => JSON.stringify({ day: 42, hp: 80, stats: { kills: 17 }, inv: { can: 2 }, ...o })

/* ─────────────── ① 商人批量购买 ─────────────── */
describe('M39 · 商人批量购买', () => {
  const row = { id: 'a9_fmj', n: 15, cost: 28, stock: 3 }

  it('材料够、库存够：买满 = min(库存, 买得起, 99)', () => {
    const p = buyPlan(row, 1, 1000, 3, 'max')
    expect(p.each).toBe(28)
    expect(p.max).toBe(3)
    expect(p.times).toBe(3)
    expect(p.total).toBe(84)
    expect(p.reason).toBe('')
  })
  it('材料不够买满 → 按买得起的份数成交，并说明是材料限制', () => {
    const p = buyPlan(row, 1, 60, 3, 'max')
    expect(p.times).toBe(2)          // 60 / 28 = 2
    expect(p.total).toBe(56)
    expect(buyPlan(row, 1, 60, 3, 5).times).toBe(2)
    expect(buyPlan(row, 1, 60, 3, 5).reason).toContain('材料只够 2 份')
  })
  it('今天只剩 1 份时 x5 只买 1 份，理由写"只剩"', () => {
    const p = buyPlan(row, 1, 1000, 1, 5)
    expect(p.times).toBe(1)
    expect(p.reason).toContain('今天只剩 1 份')
  })
  it('卖完了 / 材料不够一份：一份都不成交，理由是人话', () => {
    expect(buyPlan(row, 1, 1000, 0, 'max').times).toBe(0)
    expect(buyPlan(row, 1, 1000, 0, 'max').reason).toContain('卖完了')
    expect(buyPlan(row, 1, 10, 3, 1).times).toBe(0)
    expect(buyPlan(row, 1, 10, 3, 1).reason).toContain('材料不够')
  })
  it('汇率算进每份价格（shopPrice 不低过 1 材料）', () => {
    expect(shopPrice(row, 1.5)).toBe(42)
    expect(buyPlan(row, 1.5, 100, 3, 'max').each).toBe(42)
    expect(shopPrice({ id: 'x', cost: 1 }, 0.1)).toBe(1)
  })
  it('单次上限 99 份（防手滑把材料一次砸光）', () => {
    const p = buyPlan(row, 1, 1e9, 9999, 'max')
    expect(p.max).toBe(99)
  })
  it('非法输入（NaN/负数/小数）夹回安全范围', () => {
    expect(buyPlan(row, 1, NaN as unknown as number, 3, 'max').times).toBe(0)
    expect(buyPlan(row, 1, 1000, 3.9, 2.7).times).toBe(2)
    expect(buyPlan(row, 1, 1000, -5, 'max').times).toBe(0)
  })
})

/* ─────────────── ② 口令加密导出/导入 ─────────────── */
describe('M39 · 口令加密导出/导入', () => {
  it('同一口令往返：导出再导入拿到同一份明文', async () => {
    const plain = save({ day: 77 })
    const txt = await exportSaveText(plain, 'correct horse battery', { iter: ITER })
    expect(txt.startsWith(PORT_MAGIC)).toBe(true)
    expect(await importSaveText(txt, 'correct horse battery')).toBe(plain)
  })
  it('导出文本里没有明文痕迹（存档内容不会漏出去）', async () => {
    const txt = await exportSaveText(save({ secret: 'TOP-SECRET-MARKER' }), 'pw-123456', { iter: ITER })
    expect(txt).not.toContain('TOP-SECRET-MARKER')
    expect(txt).not.toContain('day')
  })
  it('口令错 → 人话报错（不是把 AES 的 OperationError 抛给玩家）', async () => {
    const txt = await exportSaveText(save(), 'right-password', { iter: ITER })
    await expect(importSaveText(txt, 'wrong-password')).rejects.toThrow('口令不对')
  })
  it('导出文本被改动 → 认证失败（GCM 带认证，可判定）', async () => {
    const txt = await exportSaveText(save(), 'right-password', { iter: ITER })
    const head = txt.slice(0, txt.length - 8)
    const broken = head + (txt.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    await expect(importSaveText(broken, 'right-password')).rejects.toThrow(/口令不对|不是本游戏/)
  })
  it('口令太短 / 纯数字：直接拒绝导出，并给可执行的建议', async () => {
    expect(passphraseIssue('123')).toContain('至少 ' + PORT_MIN_PW + ' 位')
    expect(passphraseIssue('123456789')).toContain('全数字')
    expect(passphraseIssue('abc123')).toBe('')
    await expect(exportSaveText(save(), '123')).rejects.toThrow('至少')
    expect(passphraseWeak('abc123')).toBe(true)          // 合规但偏短
    expect(passphraseWeak('a-longer-passphrase')).toBe(false)
  })
  it('头部解析：正确的认，乱码/换 magic/改迭代次数上限的一律不认', async () => {
    const txt = await exportSaveText(save(), 'pw-123456', { iter: ITER })
    const h = parsePortText(txt)
    expect(h && h.iter).toBe(ITER)
    expect(h && h.iv.length).toBe(12)
    expect(parsePortText('hello world')).toBe(null)
    expect(parsePortText('ZSVEXP0:1000:aa:bb:cc')).toBe(null)
    expect(parsePortText(txt.replace(PORT_MAGIC + ITER, PORT_MAGIC + '99'))).toBe(null)          // 迭代次数太小 = 不像我们的文本
    expect(parsePortText('  \n' + txt + '  ') !== null).toBe(true)                                // 前后空白要容忍（粘贴常带换行）
  })
  it('导入预览能读出第几天/击杀/背包种类；坏 JSON 返回 null', () => {
    const s = portSummary(save({ day: 12, stats: { kills: 5 }, inv: { can: 1, water: 3 } }))
    expect(s).toEqual({ day: 12, kills: 5, hp: 80, invKinds: 2, savedAt: null })
    expect(portSummary('{oops')).toBe(null)
    expect(portSummary('[]')).toBe(null)
  })
  it('导出体量与文件名（文件名带天数与时间，方便一眼认出）', () => {
    expect(portSizeKb('x'.repeat(2048))).toBe('2.0 KB')
    const name = portFileName(42, new Date(2026, 8, 15, 9, 5))
    expect(name).toBe('zombie-survival-d42-20260915-0905.zsv.txt')
    expect(portFileName(0, new Date(2026, 0, 1, 0, 0))).toContain('-d1-')
  })
})

/* ─────────────── ③ 备份历史 ─────────────── */
describe('M39 · 备份历史（轮转快照）', () => {
  const T0 = 1_700_000_000_000
  const entry = (at: number, day: number, hash = 'h' + at): BackupEntry => ({ key: 'b' + at, at, day, kills: 0, score: 0, size: 100, hash })

  it('元信息从明文里抽（第几天/击杀/体积/指纹）；坏 JSON 不抛异常', () => {
    const m = snapshotMeta(save({ day: 9, stats: { kills: 3 } }), T0)
    expect(m.day).toBe(9)
    expect(m.kills).toBe(3)
    expect(m.at).toBe(T0)
    expect(m.size).toBe(utf8Len(save({ day: 9, stats: { kills: 3 } })))
    expect(m.hash).toBeTruthy()
    const bad = snapshotMeta('{not json', T0)
    expect(bad.day).toBe(1)
    expect(bad.size).toBeGreaterThan(0)
  })
  it('中文按 3 字节算（别用 String.length 估容量）', () => {
    expect(utf8Len('中')).toBe(3)
    expect(utf8Len('a中')).toBe(4)
    expect(utf8Len('🚗')).toBe(4)
  })
  it('第一份一定存；内容一样 / 同一天太密 / 太大 → 不存（并说明为什么）', () => {
    expect(shouldSnapshot([], snapshotMeta(save(), T0)).ok).toBe(true)
    const list = [entry(T0, 10)]
    expect(shouldSnapshot(list, { ...snapshotMeta(save(), T0 + 60_000), hash: 'h' + T0 }).ok).toBe(false)   // 内容没变
    expect(shouldSnapshot(list, snapshotMeta(save({ day: 10, hp: 70 }), T0 + 60_000)).why).toContain('不到 5 分钟')
    expect(shouldSnapshot([entry(T0, 10), entry(T0 - MIN_GAP_MS, 10)], snapshotMeta(save({ day: 10, hp: 60 }), T0 + MIN_GAP_MS)).why).toContain('已经存了')
    const big = shouldSnapshot(list, { ...snapshotMeta(save(), T0 + MIN_GAP_MS), size: MAX_SNAPSHOT_BYTES + 1 })
    expect(big.ok).toBe(false)
    expect(big.why).toContain('太大')
  })
  it('天数变了必存（无视间隔与同日份数）', () => {
    const list = [entry(T0, 10), entry(T0 - 1000, 10)]
    const v = shouldSnapshot(list, snapshotMeta(save({ day: 11 }), T0 + 1000))
    expect(v.ok).toBe(true)
    expect(v.why).toContain('天数变了')
  })
  it('同一天的补充快照：过了间隔且当天还没存满 → 存', () => {
    const list = [entry(T0, 10)]
    expect(shouldSnapshot(list, snapshotMeta(save({ day: 10, hp: 55 }), T0 + MIN_GAP_MS)).ok).toBe(true)
  })
  it('轮转：新的在最前，超过份数丢最老的', () => {
    const list = [entry(T0 - 3 * MIN_GAP_MS, 8), entry(T0 - 2 * MIN_GAP_MS, 9), entry(T0 - MIN_GAP_MS, 10), entry(T0, 11)]
    const { list: next, dropped } = rotateBackups(list, entry(T0 + MIN_GAP_MS, 12), 3)
    expect(next.map(e => e.day)).toEqual([12, 11, 10])
    expect(dropped.map(e => e.day)).toEqual([9, 8])
  })
  it('轮转按时间排序（不信任传入顺序），同 key 不重复', () => {
    const list = [entry(T0, 10), entry(T0 - MIN_GAP_MS, 9)]
    const { list: next } = rotateBackups(list, entry(T0 - 2 * MIN_GAP_MS, 8), 5)
    expect(next.map(e => e.at)).toEqual([T0, T0 - MIN_GAP_MS, T0 - 2 * MIN_GAP_MS])
    const again = rotateBackups(next, entry(T0, 10), 5)
    expect(again.list.filter(e => e.key === 'b' + T0).length).toBe(1)
  })
  it('存储键撞车时补序号', () => {
    expect(backupKey(T0, [])).toBe('b' + T0)
    expect(backupKey(T0, ['b' + T0])).toBe('b' + T0 + '-2')
    expect(backupKey(T0, ['b' + T0, 'b' + T0 + '-2'])).toBe('b' + T0 + '-3')
  })
  it('标签与相对时间（玩家看得懂的一句话）', () => {
    expect(relativeTime(T0, T0 + 30_000)).toBe('刚刚')
    expect(relativeTime(T0, T0 + 12 * 60_000)).toBe('12 分钟前')
    expect(relativeTime(T0, T0 + 3 * 3600_000)).toBe('3 小时前')
    expect(relativeTime(T0, T0 + 50 * 3600_000)).toBe('2 天前')
    const label = backupLabel({ at: T0, day: 42, kills: 17, score: 820, size: 12_288, hash: 'x' }, T0 + 60_000)
    expect(label).toContain('第 42 天')
    expect(label).toContain('1 分钟前')
    expect(label).toContain('击杀 17')
    expect(label).toContain('评分 820')
    expect(label).toContain('12.0 KB')
  })
  it('按 key 查找；坏存档列表 → 空列表（存档页不许白屏）', () => {
    expect(findBackup([entry(T0, 1)], 'b' + T0)?.day).toBe(1)
    expect(findBackup([entry(T0, 1)], 'nope')).toBe(null)
    expect(parseBackupList('{oops')).toEqual([])
    expect(parseBackupList(null)).toEqual([])
    expect(parseBackupList('[{"key":"a"},{"nope":1}]')).toEqual([])
    const okList = parseBackupList(JSON.stringify([{ key: 'b2', at: T0 + 10, day: 3 }, { key: 'b1', at: T0, day: 2, text: 'ZSV1:x' }]))
    expect(okList.map(e => e.key)).toEqual(['b2', 'b1'])
    expect(okList[1].text).toBe('ZSV1:x')
    expect(BACKUP_SLOTS).toBeGreaterThanOrEqual(4)
    expect(SAME_DAY_KEEP).toBe(2)
  })
})

/* ─────────────── 接线 ─────────────── */
describe('M39 · 接线（规则只在 v4 核心里，legacy 只调用）', () => {
  const legacy = readFileSync('src/legacy/game.ts', 'utf8')
  const vaultSrc = readFileSync('src/v4/save-vault.ts', 'utf8')
  it('商人批量购买：buyMerchant 走 buyPlan，按钮上是实时算出来的份数', () => {
    expect(legacy).toContain('buyPlan(m, merchantRate(), S.mat, shopLeft(m)')
    expect(legacy).toContain("'买满×'")
    expect(legacy).toContain("onclick=\"buyMerchant(' + i + ',' + k + ')\"")
  })
  it('导出/导入与备份历史都有入口，并挂在菜单上', () => {
    expect(legacy).toContain('onclick="closeAllModals();openSavePort()"')
    expect(legacy).toContain('onclick="closeAllModals();openBackupHistory()"')
    expect(legacy).toContain('openSavePort, openBackupHistory, restoreHistory, exportHistory, deleteHistory')
  })
  it('每次存档顺手考虑快照（节流在 vault 侧）', () => {
    expect(legacy).toContain('v.maybeSnapshot(payload)')
    expect(vaultSrc).toContain("const BAK_LIST_KEY = 'zombie_survival_backups_v1'")
    expect(vaultSrc).toContain('maybeSnapshot(plain: string, force = false)')
    expect(vaultSrc).toContain('readBackupAt(key: string)')
    expect(vaultSrc).toContain('deleteBackupAt(key: string)')
  })
  it('导入/回滚都走 migrateSave + sanitizeSave（坏档进不来）', () => {
    expect(legacy).toContain('function adoptPlainSave(plain, why)')
    expect(legacy).toContain('migrateSave(JSON.parse(plain))')
  })
})
