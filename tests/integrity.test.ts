/* M8 存档完整性单测：指纹稳定、改一个数字就露馅、越界值在 sanitize 之前就能看穿、链条断裂、老存档不误判。 */
import { describe, expect, it } from 'vitest';
import { canon, digest, implausible, rawForInspect, stamp, verdictText, verify, INTEGRITY_KEY } from '../src/v4/integrity-core';

const base = () => ({ v: 2, day: 5, ap: 7, apMax: 9, hp: 80, hpMax: 100, sta: 60, staMax: 100, hun: 55, thi: 44, infect: 3, ammo: 12, mat: 30, noise: 1, inv: { can: 2, wood: 5 } });

describe('指纹（canon + digest）', () => {
  it('同一份存档永远得到同一个指纹；键顺序不影响', () => {
    const a = stamp({ v: 2, day: 5, inv: { can: 2, wood: 5 } }, undefined, '2026-01-01T00:00:00.000Z');
    const b = stamp({ inv: { wood: 5, can: 2 }, day: 5, v: 2 }, undefined, '2026-01-01T00:00:00.000Z');
    expect(a.d).toBe(b.d);
    expect(digest(canon({ a: 1, b: [1, 2, { c: 3 }] }))).toBe(digest(canon({ b: [1, 2, { c: 3 }], a: 1 })));
  });

  it('改一个数字指纹就变（顺手改一下就会被发现）', () => {
    const s = base();
    const before = stamp(s).d;
    s.mat = 31;
    expect(stamp(s).d).not.toBe(before);
    expect(before).toHaveLength(16);
  });

  it('指纹字段自己不参与计算（否则永远自相矛盾）', () => {
    const s: Record<string, unknown> = base();
    const d1 = digest(canon(s));
    s[INTEGRITY_KEY] = stamp(s);
    expect(digest(canon(s))).toBe(d1);
  });

  /* M36 自查：活对象里的 undefined / 函数在 JSON.stringify 里会被丢掉，
     以前 canon 会写成 "k":null → 内存里的 S 与落盘字符串算出两个指纹，
     于是"盖章"被静默跳过（本地档永远没指纹、上传的档验不过）。这条把它钉死。 */
  it('canon 与 JSON.stringify 同口径：undefined / 函数键一律不算', () => {
    expect(canon({ a: 1, b: undefined })).toBe(canon({ a: 1 }));
    expect(canon({ a: 1, b: () => 1 })).toBe(canon({ a: 1 }));
    const live = { day: 3, quest: { offers: [{ reward: { item: undefined, mat: 8, n: undefined } }] } };
    expect(digest(canon(live))).toBe(digest(canon(JSON.parse(JSON.stringify(live)))));
  });
});

describe('校验（verify）', () => {
  it('盖过指纹的存档校验通过', () => {
    const s: Record<string, unknown> = base();
    s[INTEGRITY_KEY] = stamp(s);
    expect(verify(s).state).toBe('ok');
    expect(verify(s).tampered).toBe(false);
  });

  it('手改数值 → mismatch；抹掉指纹 → missing（且不算篡改，兼容老存档）', () => {
    const s: Record<string, unknown> = base();
    s[INTEGRITY_KEY] = stamp(s);
    const edited = { ...s, mat: 9999 };
    expect(verify(edited).state).toBe('mismatch');
    expect(verify(edited).tampered).toBe(true);
    const bare: Record<string, unknown> = base();
    expect(verify(bare).state).toBe('missing');
    expect(verify(bare).tampered).toBe(false);
  });

  it('越界值在 sanitize 之前就被看穿（这是最强的篡改信号）', () => {
    const s: Record<string, unknown> = base();
    s[INTEGRITY_KEY] = stamp(s);
    expect(verify({ ...s, hp: 99999 }).state).toBe('implausible');
    expect(verify({ ...s, mat: -1 }).state).toBe('implausible');
    expect(verify({ ...s, hun: 250 }).state).toBe('implausible');
    expect(verify({ ...s, inv: { can: -3 } }).state).toBe('implausible');
    expect(implausible(base())).toBe(null);
  });

  it('链式指纹：中间换过一环就断链', () => {
    const a: Record<string, unknown> = base();
    const s1 = stamp(a);
    a[INTEGRITY_KEY] = s1;
    const b: Record<string, unknown> = { ...base(), day: 6 };
    const s2 = stamp(b, s1.d);
    b[INTEGRITY_KEY] = s2;
    expect(verify(b, s1.d).state).toBe('ok');
    expect(verify(b, 'deadbeefdeadbeef').state).toBe('mismatch');
  });

  it('坏数据不炸：null / 字符串 / 空对象都要有明确结论', () => {
    expect(verify(null).state).toBe('corrupt');
    expect(verify('nope' as unknown).state).toBe('corrupt');
    expect(verify({}).state).toBe('missing');
    expect(verdictText(verify(null))).toContain('损坏');
    expect(verdictText(verify({}))).toContain('老存档');
  });
});

/* M36 自查发现：M29 之后存档是 ZSV1: 密文，启动取证却还在 JSON.parse localStorage 里那份
   → 第二次启动起判 corrupt + tampered，弹「存档被修改过」。这组用例把"该拿哪一份来验"钉住。*/
describe('启动取证该拿哪一份（rawForInspect）', () => {
  const plain = JSON.stringify(base());
  const cipher = 'ZSV1:AAAA.BBBB.CCCC';

  it('密文 + 保险箱已解出明文 → 验明文（不算加密读不出）', () => {
    expect(rawForInspect(cipher, plain)).toEqual({ text: plain, encryptedUnreadable: false });
  });

  it('只有密文、这次没解开 → 不验，且不算篡改', () => {
    const r = rawForInspect(cipher, null);
    expect(r.text).toBe(null);
    expect(r.encryptedUnreadable).toBe(true);
  });

  it('明文存档（M29 之前的老档 / 降级直写）→ 原样验', () => {
    expect(rawForInspect(plain, null)).toEqual({ text: plain, encryptedUnreadable: false });
    expect(rawForInspect(plain, '')).toEqual({ text: plain, encryptedUnreadable: false });
  });

  it('压根没有存档 → text=null 但不是"密文读不出"', () => {
    expect(rawForInspect(null, null)).toEqual({ text: null, encryptedUnreadable: false });
  });

  it('解密结果与密文同时存在时，以解密明文为准（密文里那些字符不该被当成档）', () => {
    const stamped: Record<string, unknown> = base();
    stamped[INTEGRITY_KEY] = stamp(stamped);
    const text = JSON.stringify(stamped);
    const r = rawForInspect(cipher, text);
    expect(verify(JSON.parse(r.text as string)).state).toBe('ok');
  });
});
