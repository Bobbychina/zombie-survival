/* M29 账号库存档加密（account-vault-core.ts）单测：
   1) 信封格式 / 校验和能抓出手改；
   2) 按前缀预生成密钥流下的同步加解密正确性（含大文本、多次往返）；
   3) 存档对象 ↔ 密文串；
   4) 换一把密钥就解不开（诚实边界：换浏览器/清数据 = 读不回来）。 */
import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  ENVELOPE_MAGIC, checksum, isEnvelope, makeCipher, newPrefix, parseEnvelope, sealSave, sealText,
  unsealSave, unsealText, worthSealing, type SyncCipher,
} from '../src/v4/account-vault-core';

const subtle = (webcrypto as unknown as Crypto).subtle;
const rand = (n: number) => (webcrypto as unknown as Crypto).getRandomValues(new Uint8Array(n));
const makeKey = () => subtle.generateKey({ name: 'AES-CTR', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
const deps = { subtle, randomBytes: rand };

async function cipherFor(key: CryptoKey): Promise<SyncCipher> {
  const c = makeCipher(key, deps);
  await c.prepare(newPrefix(deps), 4096);
  return c;
}
/** 封装：先备流再同步封（跟 account-vault.ts 里的 sealAsync 同一套路） */
async function seal(c: SyncCipher, plain: string): Promise<string> {
  const prefix = newPrefix(deps);
  await c.prepare(prefix, new TextEncoder().encode(plain).length);
  return sealText(c, plain, prefix);
}
async function unseal(c: SyncCipher, env: string): Promise<string> {
  const e = parseEnvelope(env)!;
  await c.prepare(e.prefix, e.bytes);
  return unsealText(c, env);
}

describe('M29 账号库存档加密', () => {
  it('信封带 ZSV2: 前缀，且不是明文', async () => {
    const c = await cipherFor(await makeKey());
    const env = await seal(c, JSON.stringify({ day: 33, mat: 777 }));
    expect(env.startsWith(ENVELOPE_MAGIC)).toBe(true);
    expect(env).not.toContain('day');
    expect(env).not.toContain('777');
    expect(isEnvelope(env)).toBe(true);
    expect(isEnvelope({ day: 1 })).toBe(false);
    expect(parseEnvelope(env)).not.toBe(null);
    expect(parseEnvelope('ZSV2:broken')).toBe(null);
  });

  it('同步加解密来回一致（含中文与长文本）', async () => {
    const c = await cipherFor(await makeKey());
    const samples = ['', 'x', '{"day":33,"mat":777}', '幸存者：第 33 天，弹药 12 发。'.repeat(50)];
    for (const s of samples) {
      const env = await seal(c, s);
      expect(await unseal(c, env)).toBe(s);
    }
  });

  it('同一条密文可以解很多次（游标不会吃错位）', async () => {
    const c = await cipherFor(await makeKey());
    const env = await seal(c, '{"day":33}');
    const e = parseEnvelope(env)!;
    await c.prepare(e.prefix, e.bytes);
    for (let i = 0; i < 5; i++) expect(unsealText(c, env)).toBe('{"day":33}');
  });

  it('大文本（超过一次密钥流长度）也能来回', async () => {
    const c = await cipherFor(await makeKey());
    const big = JSON.stringify({ blob: 'a'.repeat(200000) });
    const env = await seal(c, big);
    expect(await unseal(c, env)).toBe(big);
  });

  it('手改一个字符 → 校验和报错，不会静默读出错数据', async () => {
    const c = await cipherFor(await makeKey());
    const env = await seal(c, '{"day":33,"mat":777}');
    const i = env.length - 3;
    const bad = env.slice(0, i) + (env[i] === 'A' ? 'B' : 'A') + env.slice(i + 1);
    await expect(unseal(c, bad)).rejects.toThrow();
  });

  it('校验和能区分长度相同但内容不同的明文', () => {
    expect(checksum('abc')).not.toBe(checksum('abd'));
    expect(checksum('abc')).toBe(checksum('abc'));
  });

  it('换一把密钥就解不开（诚实边界：换浏览器/清数据 = 读不回来）', async () => {
    const c1 = await cipherFor(await makeKey());
    const env = await seal(c1, '{"day":1}');
    const c2 = await cipherFor(await makeKey());
    await expect(unseal(c2, env)).rejects.toThrow();          // 垃圾明文 → 校验和不匹配
  });

  it('存档对象打包：对象才加密，标量原样', async () => {
    const c = await cipherFor(await makeKey());
    const save = { day: 33, inv: { ammo: 12 }, who: '阿岚' };
    const plain = JSON.stringify(save);
    const prefix = newPrefix(deps);
    await c.prepare(prefix, new TextEncoder().encode(plain).length);
    const env = sealSave(c, save, prefix) as string;
    expect(typeof env).toBe('string');
    expect(isEnvelope(env)).toBe(true);
    await unseal(c, env);
    expect(unsealSave(c, env)).toEqual(save);
    expect(worthSealing(save)).toBe(true);
    expect(worthSealing('plain')).toBe(false);
    expect(worthSealing(null)).toBe(false);
    expect(sealSave(c, 'plain')).toBe(null);
  });

  it('解不开就返回 null（调用方好兜底），不抛给上层', async () => {
    const c = await cipherFor(await makeKey());
    expect(unsealSave(c, 'ZSV2:zzz:zzz:zzz')).toBe(null);
    expect(unsealSave(c, 'not-an-envelope')).toBe(null);
  });
});
