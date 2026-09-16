/* M49：「现场日志不知道为什么无法自动滚动」（用户报障）
 *
 * 根因：`#log` 的 CSS 是 `scroll-behavior:smooth` —— 程序设完 `scrollTop` 之后还有一段动画在跑。
 * 而 M43 的判据是"写这一行之前量一下离底多远（≤48px 才算贴底）"：动画还没跑完时量到的是"离底两千多像素"，
 * 于是**下一行**日志被判定成"玩家往上翻了"，从那一行起再也不跟（实测连打 40 行后离底 2323px，一动不动；
 * 同一份代码把 scroll-behavior 临时改成 auto 后离底 0）。
 *
 * 所以判据换成"玩家意图"状态机：只有玩家的动作（轮子往上 / 手指把内容往下拖 / PgUp）才关掉跟随，
 * 程序补底期间产生的滚动事件一律不参与判断。这份测试钉住这台状态机（距离只用来更新"玩家滚回底部"这一条）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextLogFollow, isAwayKey, isBackKey, shouldStickToBottom } from '../src/v4/scroll-keep';

const legacy = readFileSync('src/legacy/game.ts', 'utf8');

describe('M49 · 跟随开关（nextLogFollow）', () => {
  it('默认是跟着的：没有玩家动作就不改判定', () => {
    expect(nextLogFollow(true, {})).toBe(true);
    expect(nextLogFollow(false, {})).toBe(false);
  });

  it('玩家的动作说了算：轮子往上 / 手指往下拖 → 立刻停跟随', () => {
    expect(nextLogFollow(true, { userScrollingUp: true })).toBe(false);
    expect(nextLogFollow(false, { userScrollingUp: true })).toBe(false);
  });

  it('程序自己补底造成的滚动**不算**玩家意图（smooth 动画再久也不会误判）', () => {
    expect(nextLogFollow(true, { programmatic: true })).toBe(true);
    expect(nextLogFollow(true, { programmatic: true, userScrollingUp: true })).toBe(true);   // 自己滚自己优先
  });

  it('玩家滚回底部 → 重新跟上；没到底就继续不跟', () => {
    expect(nextLogFollow(false, { userAtBottom: true })).toBe(true);
    expect(nextLogFollow(false, { userAtBottom: false })).toBe(false);
    expect(nextLogFollow(true, { userAtBottom: false })).toBe(false);
  });

  it('往上翻和"此刻在底部"同时出现时，以"往上翻"为准（人还在上面看）', () => {
    expect(nextLogFollow(true, { userScrollingUp: true, userAtBottom: true })).toBe(false);
  });

  it('键盘：PgUp/Up/Home 是离开，PgDn/Down/End 是回去', () => {
    for (const k of ['PageUp', 'ArrowUp', 'Home']) expect(isAwayKey(k), k).toBe(true);
    for (const k of ['PageDown', 'ArrowDown', 'End']) expect(isBackKey(k), k).toBe(true);
    for (const k of ['a', 'Escape', 'Enter', 'ArrowLeft']) {
      expect(isAwayKey(k), k).toBe(false);
      expect(isBackKey(k), k).toBe(false);
    }
  });

  it('距离判据还在（只是不再当"每行都量"的开关）：内容比容器短算贴底、差 100px 算翻上去了', () => {
    const box = (top: number, sh: number, ch: number) => ({ scrollTop: top, scrollHeight: sh, clientHeight: ch });
    expect(shouldStickToBottom(box(0, 300, 400))).toBe(true);
    expect(shouldStickToBottom(box(700, 1200, 400))).toBe(false);
  });
});

describe('M49 · 接线（log 面板）', () => {
  const logFn = (): string => {
    const body = legacy.slice(legacy.indexOf('function log(msg, type){'));
    return body.slice(0, body.indexOf('function clearLog'));
  };

  it('写日志只认 logFollow，**不再**每行量一次距离（那正是"日志不跟了"的根因）', () => {
    const fn = logFn();
    expect(fn).toContain('if(logFollow){');
    expect(fn).not.toMatch(/const stick\s*=\s*shouldStickToBottom/);
    expect(fn).not.toMatch(/scrollHeight\s*-\s*b\.scrollTop\s*-\s*b\.clientHeight\s*>\s*60/);
  });

  it('补底走 logPin（只受 logFollow 管），并给程序滚动打时间戳窗口', () => {
    expect(logFn()).toContain('logPin(0)');
    expect(legacy).toMatch(/function logPin\(tries\)\{[\s\S]*?if\(!b \|\| !logFollow\) return/);
    expect(legacy).toContain('logPinUntil');
  });

  it('玩家意图监听装齐：轮子 / 触摸 / 滚动条 / 键盘 / scroll 兜底，且只装一次', () => {
    const fn = legacy.slice(legacy.indexOf('function bindLogFollow(){'));
    const body = fn.slice(0, fn.indexOf('function log('));
    for (const ev of ["'wheel'", "'touchstart'", "'touchmove'", "'mousedown'", "'keydown'", "'scroll'"]) {
      expect(body, ev + ' 没监听').toContain(ev);
    }
    expect(body).toContain('box.__followBound');       // 只装一次
    expect(body).toMatch(/const inPin = logPinUntil/);                    // 程序滚动不参与判断
    expect(body).toMatch(/if\(inPin\) return;/);
    expect(body).toMatch(/if\(movedUp\) logFollowBy\(\{ userScrollingUp: true \}/);   // 往上滚：立刻停跟随
    expect(body).toContain('settleTimer');                                 // 落定后再判"回到底部没有"
  });

  it('裁掉最老那行不算玩家往上翻（scrollTop 会跟着变小，那一下是我们的）', () => {
    expect(legacy).toMatch(/removeChild\(box\.firstChild\);[\s\S]{0,200}?logPinUntil = performance\.now\(\) \+ 120/);
  });

  it('所有**程序自己**改 scrollTop 的地方都标了"我们滚的"（否则会被当成玩家往上翻，日志就再也不跟）', () => {
    /* 三条都是实测踩出来的：清空面板 → scrollTop 掉回 0；replayLog 重建 + 设偏移；
       render() 的 restoreScroll 把 #log 还原成快照里的旧偏移（内容更长 → 相对当前位置是往上跳）——
       最后这条就是玩家报的"打着打着现场日志就不跟了"。 */
    expect(legacy).toMatch(/function clearLog\(\)\{[\s\S]{0,260}?logPinUntil = performance\.now\(\) \+ 200/);
    expect(legacy).toMatch(/function replayLog\(\)\{[\s\S]*?logPinUntil = performance\.now\(\) \+ 200/);
    expect(legacy).toMatch(/restoreScroll\(keepOffsets\(snap[\s\S]{0,420}?logPinUntil = performance\.now\(\) \+ 200/);
  });

  it('所有有副作用的入口都被接上：log 会装监听、clearLog 重置为跟随、replayLog 直接贴底', () => {
    expect(logFn()).toContain('attachLogStick()');
    expect(legacy).toMatch(/function attachLogStick\(\)\{\s*bindLogFollow\(\)/)
    expect(legacy).toMatch(/function clearLog\(\)\{[^}]*logFollow = true/)
    expect(legacy).toMatch(/function replayLog\(\)\{[\s\S]*?logFollow = true/)
  });

  it('MutationObserver 的守卫也换成 logFollow（内容晚一帧长高时还能补）', () => {
    expect(legacy).toMatch(/MutationObserver\(\(\) => \{ if\(logFollow\)/)
    expect(legacy).not.toContain('logSticky')
  });
});
