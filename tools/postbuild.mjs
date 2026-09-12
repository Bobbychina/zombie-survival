/* 构建收尾：把单文件产物再复制两份——
   ① 项目根目录（双击就玩）② docs/index.html（GitHub Pages 直接把 docs 当站点根，打开就能在线玩） */
import { copyFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'dist', 'index.html');
const dst = join(root, '丧尸末日生存.html');
const pages = join(root, 'docs', 'index.html');

await copyFile(src, dst);
await copyFile(src, pages);
const a = (await stat(src)).size, b = (await stat(dst)).size, c = (await stat(pages)).size;
console.log(`[postbuild] dist/index.html → 丧尸末日生存.html  (${a} → ${b} 字节，双击即可玩)`);
console.log(`[postbuild] dist/index.html → docs/index.html  (${c} 字节，GitHub Pages 在线玩)`);
