/* v4.0 工程化拆分：把单文件游戏拆成 index.html + css + js 多文件（全部经典脚本，file:// 双击可玩）
   用法：node port.mjs <源 html> <目标目录> */
import fs from 'node:fs';
import path from 'node:path';

const src = process.argv[2];
const outDir = process.argv[3];
const html = fs.readFileSync(src, 'utf8');

// 1) 抽 CSS
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
// 2) 抽 markup（去掉 style/script/title/link）
let body = html.match(/<body>([\s\S]*?)<script>/)[1];
// 3) 抽脚本并剥掉 IIFE 外壳与导出块（多文件下函数的全局性由经典脚本保证）
let js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const iifeStart = js.indexOf(';(function(){');
const exportMark = js.indexOf('/* ── C23 工程加固：显式导出');
const exportEnd = js.lastIndexOf('})();');
const exportBlock = js.slice(exportMark, exportEnd).trim();
js = js.slice(js.indexOf('\n', iifeStart) + 1, exportMark).trimEnd();

// 4) 按段落标记切片（保持文件内原始顺序，函数声明跨文件按调用期解析）
const cuts = [
  ['00-data.js',     null,                                    '/* ───────────── 状态与存档 ───────────── */'],
  ['10-core.js',     '/* ───────────── 状态与存档 ───────────── */', '/* ───────────── 战斗 ───────────── */'],
  ['20-combat.js',   '/* ───────────── 战斗 ───────────── */',      '/* ───────────── 探索 / 区域 ───────────── */'],
  ['30-systems.js',  '/* ───────────── 探索 / 区域 ───────────── */', '/* ───────────── 图鉴 ───────────── */'],
  ['40-ui.js',       '/* ───────────── 图鉴 ───────────── */',      '/* ───────────── 进度检查 / 启动 ───────────── */'],
  ['50-boot.js',     '/* ───────────── 进度检查 / 启动 ───────────── */', null],
];
const idx = cuts.map(([f, a, b]) => {
  const from = a ? js.indexOf(a) : 0;
  const to = b ? js.indexOf(b) : js.length;
  if(from < 0 || to < 0 || to <= from) throw new Error('cut failed for ' + f + ' from=' + from + ' to=' + to);
  return [f, from, to];
});
const files = idx.map(([f, from, to]) => [f, js.slice(from, to).trimEnd() + '\n']);

fs.mkdirSync(path.join(outDir, 'css'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'js'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'css', 'game.css'), css.trim() + '\n', 'utf8');
files.forEach(([f, code]) => fs.writeFileSync(path.join(outDir, 'js', f), '"use strict";\n' + code, 'utf8'));
// 5) 全局导出垫片（内联 onclick 需要 window 上能取到 let/const 声明的状态）
fs.writeFileSync(path.join(outDir, 'js', '45-globals.js'),
  '/* 内联 onclick 只能看到 window 上的属性，而顶层 let/const 不是 window 属性：\n' +
  '   这里把状态对象挂成访问器，保证内联事件与外部脚本读写的是同一份状态。 */\n' + exportBlock + '\n', 'utf8');

// 6) index.html：保留原 markup，换成外链资源（global 垫片必须排在 boot 之前）
const order = files.map(([f]) => f);
order.splice(order.indexOf('50-boot.js'), 0, '45-globals.js');
const scripts = order.map(f => '  <script src="js/' + f + '"></script>').join('\n');
const outHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>丧尸末日生存 v4.0 · 余烬（大世界）</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>⛔</text></svg>">
<link rel="stylesheet" href="css/game.css">
</head>
<body>
${body.trim()}
${scripts}
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), outHtml, 'utf8');

console.log(JSON.stringify({ files: files.map(([f, c]) => f + ':' + c.split('\n').length + '行'), cssLines: css.split('\n').length,
  htmlLines: outHtml.split('\n').length, globalsLines: exportBlock.split('\n').length }, null, 1));
