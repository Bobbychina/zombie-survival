import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

/** `npm run test:verbose` 用：恢复内置 reporter + 不吞 console.log，排查单文件时用。 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      reporters: ['default'],
      silent: false,
    },
  }),
);
