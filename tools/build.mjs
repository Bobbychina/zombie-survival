/* M29：构建脚本 —— 在**同一个进程**里先内联 worker 源码，再调 vite 构建，最后还原。
   为什么不用 `node a && vite build && node b` 这种链式写法：
   Vite 加载配置时会另起一次配置打包，实测"先内联、再由 npm 串起 vite"时 vite 读到的仍是旧内容
   （dist 里留下占位符 `__VAULT_WORKER__`，Worker 直接建不起来 → 主线程降级）。
   同一进程内 `await build()` 就没有这个问题。

   内联的是什么：`src/v4/vault-worker.ts`（worker 运行期源码，含 AES-GCM-256 密钥逻辑）
   → 写进 `src/v4/vault-worker-src.ts` 的 `VAULT_WORKER_SRC` 字符串，构建完把占位文件还原。 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workerPath = resolve(root, 'src/v4/vault-worker.ts');
const srcPath = resolve(root, 'src/v4/vault-worker-src.ts');

function inlineWorker() {
  const original = readFileSync(srcPath, 'utf8');
  const src = readFileSync(workerPath, 'utf8');
  const runtime = src
    .replace(/^import[\s\S]*?from\s+'[^']*';\s*$/gm, '')
    .replace(/^\s*export\s+/gm, '');
  const body = '/* 构建期生成：worker 运行期源码。源仓库里这一行是占位符，构建时被 tools/build.mjs 替换。 */\n'
    + 'export const VAULT_WORKER_SRC = ' + JSON.stringify(runtime) + ';\n';
  writeFileSync(srcPath, body, 'utf8');
  console.log('[build] 已内联 vault-worker.ts（' + runtime.length + ' 字符）');
  return () => { writeFileSync(srcPath, original, 'utf8'); console.log('[build] 占位文件已还原'); };
}

const restore = inlineWorker();
try {
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: root, stdio: 'inherit', shell: true });
  if (tsc.status !== 0) { console.error('[build] tsc 失败，停止构建'); process.exit(tsc.status ?? 1); }
  const { build } = await import('vite');
  await build();
  spawnSync('node', ['tools/postbuild.mjs'], { cwd: root, stdio: 'inherit', shell: true });
} finally {
  restore();
}
