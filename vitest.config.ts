import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /* 静音口径（2026-09-23）：
       - 自定义 reporter：全绿只打一行汇总（`✓ tests 856/856`），有失败才逐条打用例名 + 断言差异。
         内置 reporter 在非 TTY 下逐文件刷 63 行、TTY 下逐用例刷 856 行，跑一次就淹掉终端与日志。
       - silent: true —— 测试自身的 console.log 也不打；要看详细输出用 `npm run test:verbose`
         （走 vitest.verbose.config.ts，恢复内置 default reporter）。 */
    reporters: [['./tools/vitest-quiet-reporter.mjs', {}]],
    silent: true,
  },
});
