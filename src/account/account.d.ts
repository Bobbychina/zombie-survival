/* src/account/account.js 的类型声明：那个文件是原生 JS（同时被 /games/ 大厅直接 <script> 引用，
   保持"一份源码两处用"），这里只声明游戏侧用到的那部分接口。 */
export interface AccountProviderGitHub { login: string; name: string; avatar?: string; boundAt: string }
export interface AccountProviderMS { name: string; email?: string; oid?: string; boundAt: string }
export interface AccountUser {
  uid: string;
  name: string;
  email: string;
  createdAt: string;
  providers: { github?: AccountProviderGitHub; microsoft?: AccountProviderMS };
  saveGames: string[];
}
export interface SaveSlot { slot: string; updatedAt: string; bytes: number }
export interface AccountResult { ok: boolean; err?: string; uid?: string; user?: AccountUser;[k: string]: unknown }

export interface DshAccount {
  version: string;
  register(o: { name: string; password: string; email?: string }): Promise<AccountResult>;
  login(o: { name: string; password: string }): Promise<AccountResult>;
  logout(): AccountResult;
  current(): AccountUser | null;
  changePassword(oldPass: string, newPass: string): Promise<AccountResult>;
  deleteAccount(confirmName: string): AccountResult;
  bindGitHubToken(token: string): Promise<AccountResult>;
  bindGitHubOAuth(): Promise<AccountResult>;
  bindGitHubDevice(onCode?: (i: { user_code: string; verification_uri: string }) => void): Promise<AccountResult>;
  bindMicrosoft(): Promise<AccountResult>;
  unbind(provider: 'github' | 'microsoft'): AccountResult;
  config(): { github: { clientId: string }; microsoft: { clientId: string } };
  slots(game: string): SaveSlot[];
  saveGet(game: string, slot: string): unknown;
  saveInfo(game: string, slot: string): { updatedAt: string; bytes: number; cloud?: unknown } | null;
  savePut(game: string, slot: string, data: unknown, opts?: { cloud?: unknown }): AccountResult;
  saveDelete(game: string, slot: string, quiet?: boolean): AccountResult;
  syncNow(game: string): Promise<AccountResult & { pulled?: string[]; pushed?: string[]; provider?: string }>;
  pushAll(game: string): Promise<AccountResult & { pushed?: string[]; provider?: string }>;
  pullAll(game: string): Promise<AccountResult & { pulled?: string[]; provider?: string }>;
  cloudSummary(game: string): Promise<AccountResult & { remote?: SaveSlot[] }>;
  cloudDelete(game: string, slot: string): Promise<AccountResult>;
  exportAll(): { ok: boolean; json?: string; name?: string; err?: string };
  importAll(json: string): AccountResult & { count?: number };
  onChange(fn: (ev: Record<string, unknown>) => void): () => void;
}

declare global {
  interface Window {
    DSHAccount?: DshAccount;
    DSH_AUTH_CONFIG?: { redirect?: string; github?: { clientId?: string; scope?: string }; microsoft?: { clientId?: string; tenant?: string; scope?: string } };
  }
}
export {};
