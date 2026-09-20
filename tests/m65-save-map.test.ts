/* M65：三条"已知限制"的钉子 ——
   ① 存档写入队列（串行 + 可 flush）：两个写按顺序落盘、flush 等得到
   ② 大区图取尺寸的单位统一（屏幕像素 ÷ zoom = 布局像素）—— 这条是 DOM 代码，由探针钉
   ③ 存档里 crossings 负值夹回 0 */
import { describe, expect, it } from 'vitest';
import { defaultSaveWorld, ensureSaveWorld } from '../src/v4/worldstate';
import { setActiveRegions } from '../src/v4/regions-core';

describe('M65 写入队列（串行 + flush）', () => {
  const loadVault = async () => (await import('../src/v4/save-vault')).SaveVault;
  it('flush() 等得到队尾；pending() 反映队列长度', async () => {
    const v = await loadVault();
    expect(typeof v.flush).toBe('function');
    expect(typeof v.pending).toBe('function');
    const p1 = v.write('{"a":1}');
    const p2 = v.write('{"a":2}');
    expect(v.pending()).toBe(true);
    const r = await v.flush();
    expect(typeof r).toBe('boolean');
    expect(v.pending()).toBe(false);
    const both = await Promise.all([p1, p2]);
    expect(both.length).toBe(2);
  });

  it('写是**排队**的：前一个没结束，后一个不会先动（顺序 = 调用顺序）', async () => {
    const v = await loadVault();
    const order: number[] = [];
    const t0 = v.write('{"n":0}').then(() => { order.push(1) });
    const t1 = v.write('{"n":1}').then(() => { order.push(2) });
    await Promise.all([t0, t1]);
    await v.flush();
    expect(order).toEqual([1, 2]);
  });

  it('没有 localStorage 的极端环境也不会抛（失败进 lastError，队列照常往前走）', async () => {
    const v = await loadVault();
    const ok = await v.write('{"x":1}');
    expect(typeof ok).toBe('boolean');
    await expect(v.flush()).resolves.toBeTypeOf('boolean');
  });
});

describe('M65 crossings 负值夹回 0', () => {
  it('手改存档写成 -5 → ensure 之后是 0（不然"跨一次"的目标永远达不成）', () => {
    const seed = 'm65-clamp';
    setActiveRegions(seed);
    const S: any = { seed, world: { ...defaultSaveWorld(seed), crossings: -5 } };
    expect(ensureSaveWorld(S).crossings).toBe(0);
  });
  it('正常值/缺字段/坏值都不受影响', () => {
    const seed = 'm65-clamp2';
    setActiveRegions(seed);
    const mk = (v: unknown) => { const S: any = { seed, world: { ...defaultSaveWorld(seed), crossings: v } }; return ensureSaveWorld(S).crossings };
    expect(mk(3)).toBe(3);
    expect(mk(undefined)).toBe(0);
    expect(mk('x')).toBe(0);
    expect(mk(NaN)).toBe(0);
  });
});
