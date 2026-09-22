/* M-VS 全局榜：cf-worker 的 /api/score 契约测试（不联网 —— 用内存 KV 桩直接调 Worker 的 handle）
 *
 *  口径（改代码前先看这里）：
 *    · GET  /api/score?game=…  公开只读，**不用登录**
 *    · POST /api/score         要登录（Bearer 会话），每人 60 秒一次，只留个人最好的一局
 *    · 榜单只留前 50，按「存活时间 → 击杀 → 名字」排序，同名只占一条
 *    · 字段越界（time ≤ 0 / 负数击杀 / 离谱数值）整条拒绝，脏数据不许进榜
 */
import { describe, it, expect, beforeEach } from 'vitest'
// @ts-expect-error cf-worker.js 是给 Worker 用的纯 JS，没有类型声明（它只依赖 env.DSH_KV 的 get/put/delete/list）
import { handle } from '../tools/cf-worker.js'

/* ---------- 内存 KV（照 Cloudflare KV 的最小接口：get / put / delete / list） ---------- */
class MemKV {
  m = new Map<string, string>()
  async get(key: string, type?: string) {
    const v = this.m.get(key)
    if (v === undefined) return null
    return type === 'json' ? JSON.parse(v) : v
  }
  async put(key: string, value: string) { this.m.set(key, value) }
  async delete(key: string) { this.m.delete(key) }
  async list(opts: { prefix?: string } = {}) {
    const p = opts.prefix || ''
    return { keys: [...this.m.keys()].filter(k => k.startsWith(p)).map(name => ({ name })), list_complete: true, cursor: '' }
  }
}

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
const sha = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))

const ORIGIN = 'https://bobbychina.github.io'
let kv: MemKV
let env: { DSH_KV: MemKV }

/** 造一个已登录会话：往 KV 里塞 s:<sha256(token)>，跟 /api/login 落库的形状一致 */
async function session(uid: string, name: string) {
  const token = 'tok-' + uid
  await kv.put('s:' + (await sha(token)), JSON.stringify({ uid, name, exp: Date.now() + 86400000 }))
  return token
}
let ipSeq = 0
/* 每个请求换一个假 IP：Worker 有「每分钟每 IP 若干次」的限流，测试里不想被它挡住
   （限流本身另有一条用例专门验，见最后一条） */
const post = (body: unknown, token?: string) => new Request('https://x/api/score', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '10.0.0.' + (++ipSeq % 250), ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: JSON.stringify(body),
})
const get = (qs: string) => new Request('https://x/api/score' + qs, { headers: { origin: ORIGIN } })
const hit = async (req: Request) => { const r = await handle(req, env); return { status: r.status, body: await r.json() as any } }

const RUN = { game: 'vampire-survivors', time: 512, kills: 320, level: 12, wave: 4 }

beforeEach(() => { kv = new MemKV(); env = { DSH_KV: kv } })

describe('M-VS 全站榜 /api/score', () => {
  it('看榜不用登录：GET 返回空榜而不是 401', async () => {
    const r = await hit(get('?game=vampire-survivors'))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.list).toEqual([])
  })

  it('没有这个榜的游戏 → 400（白名单挡住任意 key）', async () => {
    const r = await hit(get('?game=whatever'))
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('bad_game')
  })

  it('没登录提交 → 401', async () => {
    const r = await hit(post(RUN))
    expect(r.status).toBe(401)
  })

  it('首次提交：上榜第 1 名，并回个人最好成绩', async () => {
    const t = await session('u1', 'alice')
    const r = await hit(post(RUN, t))
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.better).toBe(true)
    expect(r.body.rank).toBe(1)
    expect(r.body.best).toEqual({ time: 512, kills: 320, level: 12, wave: 4 })
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list.map((x: any) => x.name)).toEqual(['alice'])
  })

  it('60 秒冷却：连提交第二次 → 429 cooldown，榜单不变', async () => {
    const t = await session('u1', 'alice')
    await hit(post(RUN, t))
    const r = await hit(post({ ...RUN, time: 900 }, t))
    expect(r.status).toBe(429)
    expect(r.body.error).toBe('cooldown')
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list[0].time).toBe(512)
  })

  it('冷却过后提交更差的成绩：better=false，个人最好与榜单都不降级', async () => {
    const t = await session('u1', 'alice')
    await hit(post(RUN, t))
    await kv.delete('scorecd:u1')                       // 模拟 60 秒过去
    const r = await hit(post({ ...RUN, time: 100, kills: 5 }, t))
    expect(r.body.better).toBe(false)
    expect(r.body.best.time).toBe(512)
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list[0].time).toBe(512)
  })

  it('冷却过后提交更好的成绩：排名前移，榜单按存活时间降序', async () => {
    const ta = await session('u1', 'alice'); const tb = await session('u2', 'bob')
    await hit(post({ ...RUN, time: 300 }, ta))
    await kv.delete('scorecd:u1')
    await hit(post({ ...RUN, time: 800, kills: 999 }, tb))
    await kv.delete('scorecd:u2')
    const r = await hit(post({ ...RUN, time: 600 }, ta))   // alice 刷新自己的成绩：从 300 提到 600
    expect(r.body.better).toBe(true)
    expect(r.body.rank).toBe(2)                            // 仍在 bob（800）之后
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list.map((x: any) => [x.name, x.time])).toEqual([['bob', 800], ['alice', 600]])
  })

  it('同名只占一条（换设备重登不会重复上榜）', async () => {
    const t1 = await session('u1', 'alice'); const t2 = await session('u9', 'alice')
    await hit(post({ ...RUN, time: 300 }, t1))
    await kv.delete('scorecd:u1')
    await hit(post({ ...RUN, time: 700 }, t2))
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list.length).toBe(1)
    expect(view.body.list[0].time).toBe(700)
  })

  it('字段越界整条拒绝：time=0 / 负数击杀 / 离谱数值 / 缺字段', async () => {
    const t = await session('u1', 'alice')
    for (const bad of [{ ...RUN, time: 0 }, { ...RUN, kills: -1 }, { ...RUN, time: 1e9 }, { ...RUN, level: 0 }, { game: 'vampire-survivors' }, null]) {
      const r = await hit(post(bad, t))
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('bad_score')
    }
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list).toEqual([])                  // 一条脏数据都没进榜
  })

  it('榜单容量上限 50：第 51 个人挤不进来，最后一名被顶掉', async () => {
    for (let i = 0; i < 55; i++) {
      const t = await session('u' + i, 'p' + String(i).padStart(2, '0'))
      await hit(post({ ...RUN, time: 100 + i }, t))
      await kv.delete('scorecd:u' + i)
    }
    const view = await hit(get('?game=vampire-survivors'))
    expect(view.body.list.length).toBe(50)
    expect(view.body.list[0].time).toBe(154)            // 最高分在最前
    expect(view.body.list.map((x: any) => x.name)).not.toContain('p00')   // 最低分被挤出
  })
})
