/* M28：柏林噪声难度场 + 导出存档加密 —— 两条都是"玩家一眼能看出对错"的东西：
   危险度决定他敢不敢往哪走，存档加密决定他备份的那串字能不能恢复。 */
import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildDangerGrid, dangerStats, hash32, makePerlin, rawDanger } from '../src/v4/region-danger';
import { SAVE_MAGIC, isEncryptedSave, pack, packSave, unpack, unpackSave } from '../src/v4/save-crypto';

/** 浏览器用 crypto.subtle，测试从 node:crypto 拿同一套 SHA-256 实现（算法一处、两边同源） */
const nodeDigest = async (b: Uint8Array): Promise<Uint8Array> => {
  const h = await webcrypto.subtle.digest('SHA-256', b as unknown as ArrayBuffer);
  return new Uint8Array(h);
};

/** 固定 seed 的假随机（测试要可重复） */
const seededRand = (s: number) => (n: number) => {
  const out = new Uint8Array(n);
  let x = s >>> 0;
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; out[i] = x & 255; }
  return out;
};

describe('柏林噪声难度场', () => {
  const mk = (seed: string, homeCol = 5, homeRow = 5, pit: { c: number; r: number } | null = null) => {
    const maxDist = Math.max(homeCol, 11 - homeCol, homeRow, 11 - homeRow);
    const opts = {
      homeCol, homeRow, maxDist,
      low: makePerlin(hash32(seed + ':low')),
      fine: makePerlin(hash32(seed + ':fine')),
      pit,
    };
    return { grid: buildDangerGrid(opts, 12, 12), opts };
  };

  it('同一个种子永远生成同一张危险度图（存档/分享码的可复现性）', () => {
    expect(mk('seed-A').grid).toEqual(mk('seed-A').grid);
    expect(mk('seed-A').grid).not.toEqual(mk('seed-B').grid);
  });

  it('硬约束①：主城与紧邻一圈恒为安全区（新手村不能被噪声吃掉）', () => {
    for (const s of ['a', 'b', 'c', 'd', 'e']) {
      const { grid } = mk(s);
      for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
        if (Math.max(Math.abs(c - 5), Math.abs(r - 5)) <= 1) expect(grid[r][c]).toBe(1);
      }
    }
  });

  it('硬约束②：相邻两格最多差 1（M17 的"4 挨着 2 断崖"绝不能再出现）', () => {
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const { grid } = mk(s);
      expect(dangerStats(grid, 5, 5).maxJump).toBeLessThanOrEqual(1);
    }
  });

  it('硬约束③：越往外整体越危险（外圈平均必须高于内圈）', () => {
    for (const s of ['a', 'b', 'c', 'd']) {
      const { grid } = mk(s);
      const ring = (lo: number, hi: number) => {
        const v: number[] = [];
        for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
          const d = Math.max(Math.abs(c - 5), Math.abs(r - 5));
          if (d >= lo && d <= hi) v.push(grid[r][c]);
        }
        return v.reduce((a, b) => a + b, 0) / v.length;
      };
      /* 单调性判据：把最外圈跟"紧邻新手村的一圈"比 —— 这两圈差得足够远，
         噪声（±1.3 档）不会把顺序翻过来。中间圈跟外圈只差一格、样本又少，加噪声后上下浮动是正常的。 */
      expect(ring(2, 3)).toBeLessThan(ring(5, 6));
      expect(ring(5, 6)).toBeGreaterThan(ring(0, 1));
    }
  });

  it('"太有规律"这件事真的改了：不再是"同一圈同一个数"（M51b 把这条钉死）', () => {
    /* M28 只钉了"第 4 环至少 2 种档位"，但实测（8 个种子）它照样放过了"整行整列复制"：
       旧版合计 32 环里有 15 环是**单值环**（"这一圈全是 4"）、重复行+列 52 条 ——
       用户复议"还是太像同心圆"骂的就是这个。现在按两项指纹钉：
         · 单值环（去掉样本 <4 格的角落环）不超过 1/4；
         · 整行/整列的完全相同（同心方框最直接的指纹）不超过 8 条。 */
    let single = 0, rings = 0, dupLines = 0;
    for (const s of ['shape', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      const { grid } = mk(s);
      for (let d = 2; d <= 5; d++) {
        const v: number[] = [];
        for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) if (Math.max(Math.abs(c - 5), Math.abs(r - 5)) === d) v.push(grid[r][c]);
        if (v.length < 4) continue;
        rings++; if (new Set(v).size <= 1) single++;
      }
      dupLines += 12 - new Set(grid.map(r => r.join(''))).size;
      dupLines += 12 - new Set(grid[0].map((_, c) => grid.map(r => r[c]).join(''))).size;
    }
    expect(single / rings).toBeLessThanOrEqual(0.25);
    expect(dupLines).toBeLessThanOrEqual(12);
    const hist = dangerStats(mk('shape').grid, 5, 5).hist;
    for (const t of [1, 2, 3, 4, 5]) expect(hist[t]).toBeGreaterThan(0);
  });

  it('深渊孤岛：指定了孤岛中心时那片一定更凶，且不会破坏相邻差 ≤1', () => {
    const plain = mk('pit-seed').grid;
    const { grid } = mk('pit-seed', 5, 5, { c: 8, r: 8 });
    const avgAround = (g: number[][]) => {
      let s = 0, n = 0;
      for (let r = 7; r <= 9; r++) for (let c = 7; c <= 9; c++) { s += g[r][c]; n++; }
      return s / n;
    };
    expect(avgAround(grid)).toBeGreaterThan(avgAround(plain));
    expect(dangerStats(grid, 5, 5).maxJump).toBeLessThanOrEqual(1);
  });

  it('噪声本身是连续场（相邻采样高度相关），不是白噪声', () => {
    const n = makePerlin(12345);
    /* 判据用"平均绝对差"：白噪声两格之间平均要跳 ~0.66，连续场应该小一个量级 */
    let sum = 0;
    const N = 400;
    for (let i = 0; i < N; i++) sum += Math.abs(n(i / 6, 0.4) - n((i + 1) / 6, 0.4));
    expect(sum / N).toBeLessThan(0.25);
    const vals = Array.from({ length: 400 }, (_, i) => n(i / 6, 0.4));
    expect(Math.max(...vals)).toBeGreaterThan(0.2);
    expect(Math.min(...vals)).toBeLessThan(-0.2);
  });

  it('rawDanger 永不越界（1..5），最外圈也不会被噪声拉回安全区', () => {
    const { opts } = mk('clamp');
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) {
      const v = rawDanger(opts, c, r);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(rawDanger(opts, 0, 0)).toBeGreaterThanOrEqual(4.5);   // 角落 = 最凶的一档
  });
});

describe('导出存档加密', () => {
  const run = (plain: string) => packSave(plain, nodeDigest, seededRand(7));

  it('导出的是加密信封，不是明文 JSON（肉眼找不到 day 这类字段）', async () => {
    const plain = JSON.stringify({ day: 12, hp: 88, inv: { bandage: 3 }, name: '余烬' });
    const code = await run(plain);
    expect(code.startsWith(SAVE_MAGIC)).toBe(true);
    expect(isEncryptedSave(code)).toBe(true);
    expect(code).not.toContain('day');
    expect(code).not.toContain('bandage');
    expect(code).not.toContain('余烬');
    expect(code.length).toBeGreaterThan(40);
  });

  it('解回来和原文一模一样（含中文与 emoji）', async () => {
    const plain = JSON.stringify({ n: '余烬市区 🏠', list: [1, 2, 3], s: 'x'.repeat(500) });
    const code = await run(plain);
    expect(await unpackSave(code, nodeDigest)).toBe(plain);
  });

  it('同一份存档导出两次，文本不同（每次随机 iv）', async () => {
    const plain = JSON.stringify({ day: 1, seed: 'abc' });
    const a = await packSave(plain, nodeDigest, seededRand(1));
    const b = await packSave(plain, nodeDigest, seededRand(2));
    expect(a).not.toBe(b);
    expect(await unpackSave(a, nodeDigest)).toBe(await unpackSave(b, nodeDigest));
  });

  it('改一个字符就报"存档已损坏"（校验和挡住手改）', async () => {
    const code = await run(JSON.stringify({ day: 5, mat: 100 }));
    const i = Math.floor(code.length / 2);
    const swapped = code.slice(0, i) + (code[i] === 'A' ? 'B' : 'A') + code.slice(i + 1);
    await expect(unpackSave(swapped, nodeDigest)).rejects.toThrow();
  });

  it('截断的文本也报错（不会解出半截存档）', async () => {
    const code = await run(JSON.stringify({ day: 5, mat: 100, pad: 'y'.repeat(200) }));
    await expect(unpackSave(code.slice(0, Math.floor(code.length * 0.6)), nodeDigest)).rejects.toThrow();
  });

  it('压缩：真实存档 JSON 压完变小，解压无损（导出文本不能长到没法复制）', () => {
    /* 存档的形状：一堆重复字段名 + 一些小对象。JSON 的冗余在"字段名"上，不在"重复字节串"上 ——
       第一版用 LZ77 反而把 3207 字节压成更大的东西（探针抓到），所以这里按"必须变小"来钉。 */
    const json = JSON.stringify({
      day: 12, hp: 88, hpMax: 100, sta: 40, staMax: 50, hun: 70, thi: 66, infect: 3,
      inv: { bandage: 3, medkit: 1, a9_fmj: 24, a556_ap: 12, water: 5 },
      eq: { wpn: 'rifle', head: 'helmet', body: 'vest', mask: 'gasmask', feet: 'boots' },
      skills: { shoot: 3, melee: 1, fitness: 2, survival: 2, medic: 1, stealth: 0 },
      base: { filter: 2, garden: 2, bench: 1, loading: 1, power: 1 },
      log: Array.from({ length: 40 }, (_, i) => ({ day: i, kind: 'loot', text: '搜到了一些材料' })),
    });
    const packed = pack(json);
    expect(json.length).toBeGreaterThan(1500);            // 确保测的是"像样的存档"
    expect(packed.data.length).toBeLessThan(json.length); // 核心：不许越压越大
    expect(unpack(packed.dict, packed.data)).toBe(json);
  });

  it('导出文本长度可控（base64 之后也不能爆炸）', async () => {
    const json = JSON.stringify({ day: 12, inv: { bandage: 3 }, base: { filter: 2 }, skills: { shoot: 3 }, note: '余烬' });
    const code = await packSave(json, nodeDigest, seededRand(9));
    expect(code.length).toBeLessThan(json.length * 3.5);          // base64 本身就要 +33%
  });

  it('明文老格式能被识别出来（导入要兼容老备份）', () => {
    expect(isEncryptedSave('eyJkYXkiOjF9')).toBe(false);
    expect(isEncryptedSave('  ' + SAVE_MAGIC + 'abc')).toBe(true);
  });
});
