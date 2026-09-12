/* M8 · 存档完整性的运行时接线
   ---------------------------------------------------------------------------
   三条接线：
     1) 启动时：在 legacy 读档**之前**读原始 JSON（loadGame 会 sanitize，夹取之后就看不出越界了），
        判定 ok / tampered / corrupt，结果留在这里供界面与日志使用；
     2) 每次写档：给存档盖上指纹（链式：带上一次的指纹），随存档一起进 localStorage / 云盘；
     3) 拉云端 / 导入文件时：对拿到的原始对象先验一遍，指纹不对就不静默覆盖本机。
   注意：指纹存在存档对象内部的 __integrity 字段里，会随存档一起被 Gist 带走——
   这正是我们要的（云端那份被网页手改过，拉下来一验就知道）。
*/
import { L } from '../main';
import { canon, digest, INTEGRITY_KEY, stamp, verdictText, verify, type Verdict } from './integrity-core';

export const SAVE_KEY = 'zombie_survival_save_v2';
let lastVerdict: Verdict | null = null;
let lastDigest = '';
let tampered = false;                 // 一旦发现被改过，本局一直记着（写档时把它写进标记）

export const integritySummary = () => (lastVerdict ? verdictText(lastVerdict) : 'ℹ️ 还没检查');
export const isTampered = () => tampered;
export const lastVerdictOf = () => lastVerdict;

/** ① 启动前检查（在 L.boot() 之前调用）：读原始 JSON，不经过 sanitize */
export function inspectBeforeBoot(): Verdict {
  let rawText: string | null = null;
  try { rawText = localStorage.getItem(SAVE_KEY); } catch { rawText = null; }
  if (!rawText) {                                   // 全新一局：没有存档 ≠ 存档被改
    lastVerdict = { state: 'missing', ok: true, detail: '还没有存档（新开局）', tampered: false };
    tampered = false;
    return lastVerdict;
  }
  let raw: unknown = null;
  try { raw = JSON.parse(rawText); } catch (e) {
    lastVerdict = { state: 'corrupt', ok: false, detail: '存档 JSON 解析失败', tampered: true };
    tampered = true;
    return lastVerdict;
  }
  const v = verify(raw);
  // 新开局的空档（什么都没有）不算篡改；但"有内容却缺指纹"是可疑的，仍按 missing 提示
  lastVerdict = v;
  tampered = v.tampered;
  if (raw && typeof raw === 'object') {
    const sig = (raw as Record<string, unknown>)[INTEGRITY_KEY] as { d?: string } | undefined;
    lastDigest = sig && typeof sig.d === 'string' ? sig.d : '';
  }
  return v;
}

/** 启动后报告（有存档且指纹不对才吵人） */
export function reportAfterBoot(): void {
  const v = lastVerdict;
  if (!v) return;
  if (v.state === 'ok') { L.log('🔒 存档指纹校验通过（未被修改）。', 'dim'); return; }
  if (v.state === 'missing') { L.log('ℹ️ 这份存档没有指纹（老版本存档），本次会补上。', 'dim'); return; }
  L.log('⚠️ 存档检查：' + verdictText(v) + ' —— 成就与排行不再计入本档；想恢复干净档案就重新开一档。', 'danger');
  try { L.toast('存档被修改过', verdictText(v) + '（游戏照常能玩）', 'bad'); } catch { /* toast 不可用就算了 */ }
}

/** ② 盖指纹：给任意存档对象就地盖一枚（写档与"上传到账号"都走这里，保证两处指纹一致） */
export function stampInPlace(s: Record<string, unknown>): { d: string; at: string; prev?: string } {
  const sig: Record<string, unknown> = { ...stamp(s, lastDigest || undefined) };
  if (tampered) sig.tampered = true;                    // 被改过的档案永久带标记
  s[INTEGRITY_KEY] = sig;
  lastDigest = String(sig.d);
  return sig as { d: string; at: string; prev?: string };
}

type SaveListener = (digest: string) => void;
const saveListeners: SaveListener[] = [];
/** 订阅"有一次存档真的落盘了"——云同步用它，比包 legacy 的 autosave 靠谱（见下面 installWriteHook 的注释） */
export function onSaveWritten(cb: SaveListener): void { saveListeners.push(cb); }

/** 内存里那份状态的指纹（判断这次写入是不是"游戏自己写的"） */
function liveDigest(): string {
  try { return digest(canon(L.S as Record<string, unknown>)); } catch { return ''; }
}

/** 包装 localStorage.setItem：
 *  为什么不用 `window.writeSave = ...`？因为 legacy 是一个 IIFE，内部 28 处 autosave()/3 处 writeSave()
 *  调的是**闭包内的局部函数**，改 window 上的属性根本拦不到（第一版就这么踩空了——探针里 __integrity 一直是 null）。
 *  从 Storage.prototype 上拦，谁来写都跑不掉。 */
export function installWriteHook(): void {
  const proto = Storage.prototype as Storage & { __intHooked?: boolean };
  if (proto.__intHooked) return;
  const orig = proto.setItem;
  proto.setItem = function (key: string, value: string) {
    if (key === SAVE_KEY && typeof value === 'string') {
      try {
        const obj = JSON.parse(value);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          /* 只给"游戏自己写出来的那份"盖指纹：内容必须和内存里的 L.S 一致。
             否则就是外部（devtools / 别的脚本）直接往这个键里塞东西——这时**不盖**，
             让它带着旧指纹留在盘上，下次启动一验就是对不上，正好当证据。 */
          const live = liveDigest();
          if (live && digest(canon(obj as Record<string, unknown>)) === live) {
            const sig = stampInPlace(obj as Record<string, unknown>);
            value = JSON.stringify(obj);
            for (const cb of saveListeners) { try { cb(sig.d); } catch (e) { console.warn('[v4] 存档回调失败', e); } }
          } else {
            console.warn('[v4] 检测到不是游戏写出的存档（保留原指纹以便取证）');
          }
        }
      } catch (e) { /* 不是 JSON（不该发生）就原样写，交给 legacy 自己的容错 */ }
    }
    return orig.call(this, key, value);
  };
  proto.__intHooked = true;
}

/** ③ 校验任意一份"外来存档"（云端拉的 / 文件导入的），返回结论 + 是否会覆盖本机 */
export function verifyForeign(raw: unknown): Verdict {
  const v = verify(raw);
  if (v.tampered) tampered = true;      // 拉进来一份被改过的档，本机也就此标记
  return v;
}

/** 指纹（给云存档的 manifest 用，便于在两台设备之间比"这是不是同一份"） */
export const digestOf = (state: Record<string, unknown>): string => digest(JSON.stringify(state) ?? '');
