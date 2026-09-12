/* 模拟脚本（vitest 里跑）要把对比 JSON 落盘，但本机装 @types/node 会卡在网络上。
   这里只声明用到的那两个函数——够跑测试，又不用引入整个 Node 类型包。 */
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding?: string): string;
}
