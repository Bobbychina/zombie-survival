/* 把游戏与账号库同步到主页仓库（bobbychina.github.io）的 /games/ 下。
   —— 为什么要复制：GitHub Pages 是"一个仓库一个站点"，跨仓库没法共用路径；
      而 /games/zombie-survival/ 与 /games/ 同源，账号与存档才能共用一份 localStorage。
   用法：node tools/sync-site.mjs        （或 DSH_PAGES_REPO=<路径> node tools/sync-site.mjs）
   跑之前先 npm run build。 */
import { copyFile, mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = process.env.DSH_PAGES_REPO || join(root, '..', '..', 'bobbychina-pages');
const gameSrc = join(root, 'dist', 'index.html');
const acctSrc = join(root, 'src', 'account', 'account.js');
const gameDst = join(pages, 'games', 'zombie-survival', 'index.html');
const acctDst = join(pages, 'games', 'account.js');

try { await stat(join(pages, '.git')); }
catch (e) {
  console.error('[sync-site] 找不到主页仓库：' + pages);
  console.error('  用 DSH_PAGES_REPO=<bobbychina-pages 的路径> node tools/sync-site.mjs 指定。');
  process.exit(1);
}
try { await stat(gameSrc); }
catch (e) {
  console.error('[sync-site] 还没有构建产物，先跑 npm run build');
  process.exit(1);
}

await mkdir(dirname(gameDst), { recursive: true });
/* 游戏页也要能用"一键绑定"：把大厅的 auth-config.js 注进去。
   单文件产物本身保持自包含（离线也能玩），只是在线这份多引一个配置文件。
   注意别拿 "/games/auth-config.js" 当"是否已注入"的判据——那段路径字符串本来就出现在
   account.js 的报错文案里（bundle 里已经有了），会导致永远判定为"已注入"而跳过。 */
const TAG = '<script src="/games/auth-config.js"></script>';
const html = await readFile(gameSrc, 'utf8');
const injected = html.includes(TAG) ? html : html.replace('</head>', TAG + '\n</head>');
if (injected === html && !html.includes(TAG)) {
  console.error('[sync-site] 没找到 </head>，配置没能注入——手工检查一下 dist/index.html');
  process.exit(1);
}
await writeFile(gameDst, injected, 'utf8');
await copyFile(acctSrc, acctDst);
const g = (await stat(gameDst)).size, a = (await stat(acctDst)).size;
console.log(`[sync-site] ${gameSrc} → ${gameDst}  (${g} 字节，已注入 auth-config.js)`);
console.log(`[sync-site] ${acctSrc} → ${acctDst}  (${a} 字节)`);
console.log('[sync-site] 线上地址：https://bobbychina.github.io/games/zombie-survival/');
