/* 把已拆好的 6 个经典脚本 + 全局导出垫片，合成一个 ESM 模块 src/legacy/game.ts。
   为什么要合成一个模块：老代码内部靠"自由变量"互相引用，拆成多个 ESM 模块就得手写几百条 import；
   合成单模块后行为与之前的 IIFE 版本完全等价（导出垫片负责让内联 onclick 也能看到函数）。 */
import fs from 'node:fs';
import path from 'node:path';

const proj = process.argv[2];
const jsDir = path.join(proj, 'js');
const out = path.join(proj, 'src', 'legacy', 'game.ts');
fs.mkdirSync(path.dirname(out), { recursive: true });

const order = ['00-data.js', '10-core.js', '20-combat.js', '30-systems.js', '40-ui.js', '50-boot.js', '45-globals.js'];
let code = '';
for (const f of order) {
  let src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  src = src.replace(/^"use strict";\n/, '');
  if (f === '50-boot.js') src = src.replace(/\nboot\(\);\s*$/, '\n/* boot() 由 src/main.ts 在 v4 模块就绪后调用 */\n');
  code += `\n/* ═══════════ legacy/${f} ═══════════ */\n` + src.trimEnd() + '\n';
}
const header = ['// @ts-nocheck —— v3.0 的单文件代码整体搬进这里当底座，逐块迁出到 src/v4/*。',
  '// 不要在这个文件里加新功能：新东西写进 src/v4/，通过 window 上的名字与这里互操作。',
  ''].join('\n') + '\n';
fs.writeFileSync(out, header + code, 'utf8');
console.log(JSON.stringify({ out, lines: code.split('\n').length }, null, 1));
