/* src/account/account.js 的类型声明：那个文件是原生 JS（同时被 /games/ 大厅直接 <script> 引用，
   保持"一份源码两处用"），这里只声明游戏侧用到的那部分接口。 */
export interface AccountProviderGitHub { login: string; name: string; avatar?: string; boundAt: string; gistId?: string; serverSide?: boolean }
export interface AccountProviderMS { name: string; email?: string; oid?: string; boundAt: string }
export interface AccountUser {
  uid: string;
  name: string;
  email: string;
  createdAt: string;
  server?: boolean;                    // true = 云账号（后端在 Cloudflare）
  hasPassword?: boolean;               // false = GitHub 账号（M23 起新建的账号都没有密码）
  providers: { github?: AccountProviderGitHub; microsoft?: AccountProviderMS };
  saveGames: string[];
}
export interface SaveSlot { slot: string; updatedAt: string; bytes: number }
export interface AccountResult { ok: boolean; err?: string; uid?: string; user?: AccountUser;[k: string]: unknown }

export interface DshAccount {
  version: string;
  /** 云后端信息：enabled = 配了 api 地址；loggedIn = 当前会话带服务端 token */
  serverInfo(): { base: string; enabled: boolean; loggedIn: boolean };
  serverAvailable(): Promise<boolean>;
  /** 端到端加密状态：locked = 本标签页还没派生密钥（此时只存本地、不上传） */
  cryptoInfo(): { locked: boolean; name: string; alg: string };
  /** 重新输入口令以派生加密密钥（口令不上传） */
  unlock(password: string): Promise<AccountResult>;
  /** GitHub 绑定状态（云模式下来自服务端，不含令牌） */
  ghStatus(): Promise<{ bound: boolean; login?: string; avatar?: string; gistId?: string; serverSide?: boolean }>;
  /** 当前同步去向：云后端 / github / microsoft / null */
  backend(): 'server' | 'github' | 'microsoft' | null;
  register(o: { name: string; password: string; email?: string }): Promise<AccountResult>;
  login(o: { name: string; password: string }): Promise<AccountResult>;
  /* M23：账号 = GitHub。第一次设备码/令牌登录会自动建一条无口令的本地账号记录 */
  signInGitHub(token: string, extra?: Record<string, unknown>): Promise<AccountResult>;
  signInGitHubDevice(onCode?: (i: { user_code: string; verification_uri: string }) => void): Promise<AccountResult>;
  signInGitHubRemembered(): Promise<AccountResult>;
  rememberedGitHub(): { login: string; at: string } | null;
  ghToken(): string | null;
  logout(): Promise<AccountResult>;
  current(): AccountUser | null;
  changePassword(oldPass: string, newPass: string): Promise<AccountResult>;
  /** 今日云上传额度（服务端每账号每天 10 次，护 KV 免费额度） */
  quota(): Promise<{ ok: boolean; used?: number; limit?: number; left?: number; resetAt?: string; local?: boolean; err?: string }>;
  /** 补设恢复码：返回一次性明文 code，UI 必须让用户抄下来 */
  setRecovery(): Promise<{ ok: boolean; code?: string; err?: string }>;
  /** 忘记口令：用恢复码解开存档密钥并设新口令（老云存档不会丢） */
  recover(o: { name: string; code: string; password: string }): Promise<AccountResult>;
  deleteAccount(confirmName: string): AccountResult;
  bindGitHubToken(token: string): Promise<AccountResult>;
  bindGitHubOAuth(): Promise<AccountResult>;
  bindGitHubDevice(onCode?: (i: { user_code: string; verification_uri: string }) => void): Promise<AccountResult>;
  bindMicrosoft(): Promise<AccountResult>;
  diagnoseGitHub(): Promise<{ name: string; ok: boolean; status: number; body: string }[]>;
  unbind(provider: 'github' | 'microsoft'): AccountResult;
  /** 运行期配置（auth-config.js 注入 / 默认值）：api 配了就是"中继模式"（令牌存 Worker） */
  config(): {
    api?: string; redirect?: string;
    github: { clientId: string; scope: string };
    microsoft: { clientId: string; tenant?: string; scope?: string };
  };
  slots(game: string): SaveSlot[];
  saveGet(game: string, slot: string): unknown;
  saveInfo(game: string, slot: string): { updatedAt: string; bytes: number; cloud?: unknown } | null;
  /** noServer=true：只写本机，不自动推云（调用方紧接着自己 pushAll 时用，避免同一份存两次、白烧每日额度） */
  savePut(game: string, slot: string, data: unknown, opts?: { cloud?: unknown; noServer?: boolean; expectUpdatedAt?: string }): AccountResult;
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
