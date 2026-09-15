/* M36：作弊码机制下线的回归护栏（读源码文本，和 items.test.ts / m32b-ammo-shop.test.ts 一个套路）。
   为什么要有这组：legacy/game.ts 是个 3600 行的老底座，以后谁"顺手把彩蛋加回来"或者
   手滑把键位段删了，单测能当场拦住；顺带钉住"老档 flags.cheat 要被清掉"这条迁移。 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rawForInspect, SAVE_MAGIC } from '../src/v4/integrity-core';

const legacy = readFileSync('src/legacy/game.ts', 'utf8');
const integrity = readFileSync('src/v4/integrity.ts', 'utf8');

describe('M36：作弊码机制不能回来', () => {
  it('老作弊码、cheatBuf、Bobby 模式这些痕迹一个都不许剩', () => {
    expect(legacy).not.toContain('bobbychina32747');
    expect(legacy).not.toContain('cheatBuf');
    expect(legacy).not.toContain('Bobby 模式');
    expect(legacy).not.toContain('彩蛋');
    /* "作弊"只允许出现在那句"已下线"的注释里（迁移说明），别处出现就说明机制回来了 */
    const cheatLines = legacy.split('\n').filter(l => l.includes('作弊'));
    expect(cheatLines.length).toBeLessThanOrEqual(1);
    for (const l of cheatLines) expect(l.trim().startsWith('//') || l.includes('//')).toBe(true);
  });

  it('window 导出名单里不能有 cheat（内联 onclick/外部脚本都不该再看到它）', () => {
    const line = legacy.split('\n').find(l => l.includes('Object.assign(window, {')) || '';
    expect(line).not.toMatch(/[{,]\s*cheat\s*,/);
    expect(line).toContain('openHelp');           // 名单本身还在（别误删整行）
  });

  it('不再有任何地方给 flags.cheat 赋值（成就守卫已随机制一起删）', () => {
    expect(legacy).not.toMatch(/flags\.cheat\s*=/);
  });

  it('老档迁移保留：sanitizeSave 仍然清掉历史遗留的 flags.cheat', () => {
    expect(legacy).toContain('delete out.flags.cheat');
  });

  it('帮助弹窗的快捷键段没被误伤（Esc 那行还在，彩蛋行没了）', () => {
    expect(legacy).toContain('<kbd>Esc</kbd> 关闭弹窗</div>');
    expect(legacy).toContain("'<div class=\"sect-title\" style=\"margin-top:14px\">快捷键</div>'");
  });

  it('页签/睡觉/战斗键位映射没被删（keydown 处理器结构完整）', () => {
    expect(legacy).toMatch(/const tabs = \{ e:'explore', b:'base', i:'inv', c:'craft', k:'skills', q:'quest', j:'codex', s:'stats' \}/);
    expect(legacy).toMatch(/if\(k === 'n' && !document\.querySelector\('\.overlay'\)\) sleepNight\(\)/);
    expect(legacy).toMatch(/if\(battle\)\{/);
  });
});

describe('M36：加密存档的启动取证不许再看密文（否则每次启动都误报被改）', () => {
  it('integrity.ts 走 rawForInspect，而不是直接 JSON.parse localStorage 里那份', () => {
    expect(integrity).toContain('rawForInspect(stored, decrypted)');
    expect(integrity).not.toMatch(/rawText = localStorage\.getItem\(SAVE_KEY\)/);
  });

  it('密文前缀与保险箱保持一致（save-vault 的 MAGIC）', () => {
    expect(SAVE_MAGIC).toBe('ZSV1:');
    expect(readFileSync('src/v4/save-vault.ts', 'utf8')).toContain("const MAGIC = 'ZSV1:'");
  });

  it('解不开的密文按"读不出来"处理：不冤成篡改', () => {
    const r = rawForInspect('ZSV1:xx.yy.zz', null);
    expect(r.encryptedUnreadable).toBe(true);
    expect(r.text).toBe(null);
  });

  it('指纹链在加密路径上要真的盖上（hook 了 V4Vault.write）', () => {
    expect(integrity).toContain('vault.write = function');
    expect(integrity).toContain('stampInPlace');
  });
});
