/**
 * M39：多份备份历史（轮转快照）的纯逻辑。
 *
 * 以前只有一份 `.bak`：每次存档前把上一份挪过去 —— 等于"只能退一步"。
 * 玩家真实需求（用户勾的 QoL）：「多份备份历史 + 指定回滚」。
 *
 * 这里只算"该不该存、存了之后留哪几份、这份是哪一份"，落盘/加密在 save-vault 里。
 * 三条规则刻意写死，避免又变成"每 5 秒一份没用的快照把 localStorage 塞满"：
 *  ① 同一天最多留 `SAME_DAY_KEEP` 份（默认 2）；
 *  ② 两份之间至少隔 `MIN_GAP_MS`（默认 5 分钟）；
 *  ③ 天数变化时**无视** ①②——"过了一天"永远值得存一份。
 */

export const BACKUP_SLOTS = 6;
export const SAME_DAY_KEEP = 2;
export const MIN_GAP_MS = 5 * 60 * 1000;
/** 单份明文超过这个体量就别进历史了（localStorage 共 5MB，别把主档挤掉） */
export const MAX_SNAPSHOT_BYTES = 240 * 1024;

export interface BackupMeta {
  /** 快照时间（毫秒） */
  at: number;
  /** 游戏内天数 */
  day: number;
  kills: number;
  /** 评分（legacy 的 runScore().raw；算不出来就给 0） */
  score: number;
  /** 明文字节数 */
  size: number;
  /** 明文内容的轻量指纹（同一份内容不重复存） */
  hash: string;
}

export interface BackupEntry extends BackupMeta {
  /** 存储键（`b<at>`，同毫秒撞了就补序号） */
  key: string;
  /** 密文（本机密钥加密；不在这里解密） */
  text?: string;
}

const djb2 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** 从明文存档里抽出这份快照的元信息（解析不了也要能返回一个兜底 meta，绝不抛） */
export function snapshotMeta(plain: string, now: number = Date.now()): BackupMeta {
  let day = 1, kills = 0, score = 0;
  try {
    const d = JSON.parse(plain);
    day = Math.max(1, Math.floor(Number(d?.day) || 1));
    kills = Math.max(0, Math.floor(Number(d?.stats?.kills) || 0));
    score = Math.max(0, Math.floor(Number(d?.stats?.score) || 0));
  } catch { /* 坏内容也照存：它本来就可能是"最后一次能读出来的档" */ }
  return { at: now, day, kills, score, size: utf8Len(plain), hash: djb2(plain) };
}

/** UTF-8 字节数（中文按 3 字节算，别用 String.length 糊弄容量） */
export function utf8Len(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** 该不该存这一份？返回 true 才落盘（否则每次 autosave 都会加一份） */
export function shouldSnapshot(list: BackupEntry[], meta: BackupMeta): { ok: boolean; why: string } {
  if (meta.size > MAX_SNAPSHOT_BYTES) return { ok: false, why: '这份存档太大（' + Math.round(meta.size / 1024) + 'KB），不进历史。' };
  if (!list.length) return { ok: true, why: '第一份快照。' };
  const newest = list[0];
  if (newest.hash === meta.hash) return { ok: false, why: '和最新一份内容一样，不重复存。' };
  if (meta.day !== newest.day) return { ok: true, why: '天数变了（第 ' + newest.day + ' → ' + meta.day + ' 天）。' };
  if (meta.at - newest.at < MIN_GAP_MS) return { ok: false, why: '距上一份不到 5 分钟。' };
  const sameDay = list.filter(e => e.day === meta.day).length;
  if (sameDay >= SAME_DAY_KEEP) return { ok: false, why: '第 ' + meta.day + ' 天已经存了 ' + sameDay + ' 份。' };
  return { ok: true, why: '同一天的补充快照。' };
}

/** 生成存储键：同毫秒撞了就补 -2、-3… */
export function backupKey(at: number, taken: string[]): string {
  const base = 'b' + Math.max(0, Math.floor(at));
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 99; i++) if (!taken.includes(base + '-' + i)) return base + '-' + i;
  return base + '-' + Math.floor(Math.random() * 1e6);
}

/** 轮转：新的放最前，超过 slots 份就把最老的丢掉（返回被丢掉的，便于日志/UI 说明） */
export function rotateBackups(list: BackupEntry[], entry: BackupEntry, slots: number = BACKUP_SLOTS): { list: BackupEntry[]; dropped: BackupEntry[] } {
  const merged = [entry, ...list.filter(e => e.key !== entry.key)].sort((a, b) => b.at - a.at);
  const keep = Math.max(1, Math.floor(slots) || BACKUP_SLOTS);
  return { list: merged.slice(0, keep), dropped: merged.slice(keep) };
}

/** 相对时间：给列表用（"12 分钟前"比时间戳好读） */
export function relativeTime(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

/** 列表行的说明：第几天 / 多久以前 / 击杀 / 评分 / 体积 */
export function backupLabel(e: BackupMeta, now: number = Date.now()): string {
  return '第 ' + e.day + ' 天 · ' + relativeTime(e.at, now) + ' · 击杀 ' + e.kills +
    (e.score ? ' · 评分 ' + e.score : '') + ' · ' + (e.size / 1024).toFixed(1) + ' KB';
}

/** 按 key 找一份（找不到返回 null；UI 点"回滚"用） */
export function findBackup<T extends { key: string }>(list: T[], key: string): T | null {
  return list.find(e => e.key === key) || null;
}

/** localStorage 里那份 JSON 的安全解析（坏数据当成空列表，别让存档页白屏） */
export function parseBackupList(raw: string | null): BackupEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(e => e && typeof e === 'object' && typeof e.key === 'string' && Number.isFinite(Number(e.at)))
      .map(e => ({
        key: String(e.key),
        at: Math.max(0, Math.floor(Number(e.at))),
        day: Math.max(1, Math.floor(Number(e.day) || 1)),
        kills: Math.max(0, Math.floor(Number(e.kills) || 0)),
        score: Math.max(0, Math.floor(Number(e.score) || 0)),
        size: Math.max(0, Math.floor(Number(e.size) || 0)),
        hash: typeof e.hash === 'string' ? e.hash : '',
        text: typeof e.text === 'string' ? e.text : undefined,
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 32);
  } catch { return []; }
}
