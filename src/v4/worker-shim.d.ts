/* M29：WebWorker 的最小类型声明（本机装 @types/web 会卡网络，而 tsconfig 的 lib 只有 DOM）。
   只声明 vault-worker.ts 用到的那几样：self.onmessage / self.postMessage。 */
interface DedicatedWorkerGlobalScopeLike {
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}
