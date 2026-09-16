/* 模拟脚本（vitest 里跑）要把对比 JSON 落盘，但本机装 @types/node 会卡在网络上。
   这里只声明用到的那几个函数——够跑测试，又不用引入整个 Node 类型包。 */
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding?: string): string;
  export function readdirSync(path: string): string[];   // M52：源码级 lint（扫 src/v4 下所有文件）
}

/* M28：存档加密的测试要真跑一遍 SHA-256（浏览器用 crypto.subtle，Node 从 node:crypto 拿同一套实现），
   同样只声明用到的那一个入口，不引整个 @types/node。 */
declare module 'node:crypto' {
  export const webcrypto: {
    subtle: SubtleCrypto;
    getRandomValues<T extends ArrayBufferView | null>(array: T): T;
    randomUUID(): string;
  };
}
