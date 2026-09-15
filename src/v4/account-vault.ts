/**
 * M29 账号库加密的**接线**（DOM 侧）：把 `src/account/account.js` 的记录读写劫持进密文世界。
 *
 * 背景（用户原话）：「强制云端存档或者本地存档，不做可直接导出存档，然后加密我有一个 idea：
 *   可以生成 128 位加密密钥放在 worker 里面，然后呢每次上传存档或者本地存储都经过这个加密」。
 * 游戏主档由 `save-vault.ts` 负责（worker + AES-GCM + `ZSV1:`）；**账号库那条链路**（本机记录、
 * GitHub Gist、OneDrive）之前还是明文，这里补上（`ZSV2:`，密钥同样来自 worker 生成的那把）。
 *
 * 同步问题：`DSHAccount.saveGet()` 是同步 API，所以密钥原文要拿到主线程（`SaveVault.getKeyRaw`），
 * 再把 AES-CTR 密钥流预生成好、同步加解密（见 account-vault-core.ts）。内存里维护
 * `uid/game/slot → { sealed, plain }` 镜像：**只要账号库的按键里还是明文，就读它**（保证读到的
 * 永远是最新那份，不会出现"写新档读到旧档"）；密文写下去之后镜像就同步给明文。
 * 冷启动（刷新后）明文不在内存里，由 `hydrate()` 在异步路径里解回来。
 */
import type { DshAccount } from '../account/account.d.ts';
import { L } from '../main';
import { SaveVault } from './save-vault';
import {
  ENVELOPE_MAGIC, checksum, isEnvelope, makeCipher, newPrefix, parseEnvelope, sealText, unsealSave,
  type SyncCipher,
} from './account-vault-core';

interface Rec { sealed: string | null; plain: unknown; sig: string; held?: boolean }

type Acct = DshAccount & Record<string, any>;

let cipher: SyncCipher | null = null;
let opening: Promise<SyncCipher | null> | null = null;
let api: Acct | null = null;
let warmTimer: ReturnType<typeof setInterval> | null = null;
const deps = { subtle: crypto.subtle, randomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) };

/** 内存镜像：同一份存档的「密文 + 明文」 */
const mirror = new Map<string, Rec>();
const mkey = (uid: string, game: string, slot: string): string => uid + '|' + game + '|' + slot;
const mirrorGet = (game: string, slot: string): Rec | undefined => {
  const id = api?.currentUid?.();
  return id ? mirror.get(mkey(id, game, slot)) : undefined;
};
/** 内容指纹：密文每次都不同（随机计数器前缀），所以"镜像是不是这一份"只能比明文，不能比密文 */
const sigOf = (v: unknown): string => {
  try { return checksum(typeof v === 'string' ? v : JSON.stringify(v)); } catch { return 'x'; }
};function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把 worker 给的那把密钥原文收进主线程的同步密码 */
async function open(): Promise<SyncCipher | null> {
  if (cipher) return cipher;
  if (!opening) {
    opening = (async () => {
      const raw = await SaveVault.getKeyRaw({ tag: 'account-save-v1' }).catch(() => null);
      if (!raw) { L.log('⚠️ 账号库存档加密不可用（拿不到密钥）：本机与云上的账号存档退回明文兜底。', 'danger'); return null; }
      const key = await crypto.subtle.importKey(
        'raw', b64ToBytes(raw) as unknown as BufferSource, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt']);
      const c = makeCipher(key, deps);
      await c.prepare(newPrefix(deps), 1 << 12);
      cipher = c;
      return c;
    })();
  }
  return await opening;
}

/** 备好够长的一段密钥流（异步），再同步封一条记录；封不了就原样返回（兜底不丢档） */
async function sealAsync(obj: unknown): Promise<unknown> {
  const c = await open();
  if (!c || !obj || typeof obj !== 'object') return obj;
  let plain: string;
  try { plain = JSON.stringify(obj); } catch { return obj; }
  const bytes = new TextEncoder().encode(plain).length;    // 按**字节**备流（中文一个字 3 字节）
  const prefix = newPrefix(deps);
  await c.prepare(prefix, bytes);
  try { return sealText(c, plain, prefix); } catch { return obj; }
}

/** 冷启动后把磁盘上的密文解回内存：之后 `saveGet` 就能同步拿到明文 */
export async function hydrate(game: string, slot: string): Promise<unknown> {
  const a = api; if (!a) return null;
  const raw = a.saveGet(game, slot);
  if (raw === null || raw === undefined) return null;
  const id = a.currentUid?.();
  const k = id ? mkey(id, game, slot) : null;
  if (typeof raw === 'string' && isEnvelope(raw)) {
    const prev = k ? mirror.get(k) : undefined;
    const env = parseEnvelope(raw);
    if (!env) return null;
    /* 镜像里就是这一份（明文指纹对得上）→ 直接给明文，不必再解一次 */
    if (prev?.held && prev.sig === env.sig) return prev.plain;
    const c = await open(); if (!c) return null;
    await c.prepare(env.prefix, env.bytes);
    const obj = unsealSave(c, raw);
    if (obj === null) { L.log('⚠️ 账号库里那份存档解不开（换过浏览器 / 清过站点数据？）。', 'danger'); return null; }
    if (k) mirror.set(k, { sealed: raw, plain: obj, sig: env.sig, held: true });
    return obj;
  }
  /* 老明文记录：就地加密回写（迁移只有这一次） */
  const sealed = await sealAsync(raw);
  const sig = sigOf(raw);
  if (typeof sealed === 'string') {
    a.savePut(game, slot, sealed);
    if (k) mirror.set(k, { sealed, plain: raw, sig, held: true });
  }
  return raw;
}

/** 上传/同步之前：把某个槽在磁盘上确认成密文（云路走 `saveGet`，取到的就是密文串） */
export async function ensureSealed(game: string, slot: string): Promise<void> {
  const a = api; if (!a) return;
  const raw = a.saveGet(game, slot);
  if (raw === null || raw === undefined || isEnvelope(raw)) return;
  const plain = await hydrate(game, slot);
  if (plain === null) return;
  const sealed = await sealAsync(plain);
  if (typeof sealed === 'string') a.savePut(game, slot, sealed);
}
/** 某个游戏下**所有**槽位都确认成密文（上传前调用：上传走的是 `saveGet`，拿到的就是密文串） */
export async function sealAll(game: string): Promise<void> {
  const a = api; if (!a) return;
  for (const s of a.slots(game)) await ensureSealed(game, s.slot);
}
/** 主槽位（account-ui 里 SLOT = 'main'）：一键上传/自动同步前调用 */
export const sealMainSlot = (game: string): Promise<void> => ensureSealed(game, 'main');

/** 拉取/合并之后：把落地的密文解进内存，并把明文喂给 applySave（游戏只认明文对象） */
async function applyOnPull(game: string, slot: string, apply: (d: unknown) => boolean): Promise<void> {
  const obj = await hydrate(game, slot);
  if (obj) apply(obj);
}
/** main.ts 挂上来的 `window.V4Account.applySave`（这里不做类型依赖，避免循环 import） */
function applySaveOf(d: unknown): boolean {
  const w = window as unknown as { V4Account?: { applySave?: (x: unknown) => boolean } };
  return !!w.V4Account?.applySave?.(d);
}

/** 把某个账号名下的存档槽全部预热（登录成功 / 面板打开时调用） */
export async function warmUp(game: string): Promise<void> {
  const a = api; if (!a) return;
  for (const s of a.slots(game)) await hydrate(game, s.slot);
}

/** 劫持账号库对象：记录读写走密文，拉取后自动解密 */
export function interceptAccount(a: Acct): void {
  if (api) return;
  api = a;
  const origGet = a.saveGet.bind(a);
  const origPut = a.savePut.bind(a);
  const origPullAll = a.pullAll.bind(a);
  const origPushAll = a.pushAll.bind(a);
  const origSyncNow = a.syncNow.bind(a);
  a.saveGet = function (game: string, slot: string) {
    const raw = origGet(game, slot);
    /* 磁盘上还是明文（原生路径写的）→ 直接给明文，别让镜像里的旧值盖掉新档 */
    if (typeof raw !== 'string' || !isEnvelope(raw)) return raw;
    const env = parseEnvelope(raw);
    const rec = mirrorGet(game, slot);
    return (env && rec?.held && rec.sig === env.sig) ? rec.plain : raw;
  };
  a.savePut = function (game: string, slot: string, data: unknown, opts?: any) {
    const id = a.currentUid?.();
    const k = id ? mkey(id, game, slot) : null;
    const sig = sigOf(data);
    if (k) mirror.set(k, { sealed: null, plain: data, sig });
    const r = origPut(game, slot, data, opts);        // 同步落盘（保证数据不丢）
    /* 密文写盘是异步的，下一拍覆盖；`noServer` 保证不会用明文多推一次云 */
    void (async () => {
      const sealed = await sealAsync(data);
      if (typeof sealed !== 'string') return;
      origPut(game, slot, sealed, { ...(opts || {}), noServer: true });
      if (k) mirror.set(k, { sealed, plain: data, sig, held: true });
    })();
    return r;
  };
  a.pullAll = async function (game: string) {
    const r = await origPullAll(game);
    await applyOnPull(game, 'main', (d) => !!applySaveOf(d));
    return r;
  };
  /* 上传前先确保磁盘上是密文：account.js 的上传循环走 `saveGet`，取到的就是密文串
     —— 这一步是"Gist / OneDrive 里也是密文"的关键 */
  a.pushAll = async function (game: string) {
    await sealAll(game).catch(() => undefined);
    return await origPushAll(game);
  };
  a.syncNow = async function (game: string) {
    await sealAll(game).catch(() => undefined);
    const r = await origSyncNow(game);
    await applyOnPull(game, 'main', (d) => !!applySaveOf(d));
    return r;
  };
  void open();                                   // 后台先把密钥收好
  /* 账号库自己挑账号（切号/新登录）时会走原生路径写明文，这里定期补一次加密 + 预热 */
  if (!warmTimer) warmTimer = setInterval(() => { void warmUp('zombie-survival'); }, 15000);
  L.log('🔐 账号库存档已加密（' + ENVELOPE_MAGIC + ' 密文落盘，密钥来自 worker 生成的那把）。', 'dim');
}

/** 账号库就绪后调用一次 */
export function initAccountVault(): void {
  const a = window.DSHAccount as Acct | undefined;
  if (!a) { L.log('ℹ️ 账号库没加载：本机只跑游戏主档（同样加密）。', 'dim'); return; }
  interceptAccount(a);
  void warmUp('zombie-survival');
}

/* 探针用：当前是否已经拿到密钥、镜像里有多少条 */
export const accountVaultStatus = () => ({
  keyReady: !!cipher,
  magic: ENVELOPE_MAGIC,
  mirrored: mirror.size,
});
