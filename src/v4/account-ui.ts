/* M8 · 账号与云存档（游戏侧界面）
   ---------------------------------------------------------------------------
   账号库本体在 src/account/account.js：原生 JS、零依赖，同一份文件既被这里的
   单文件构建打进游戏（离线也能注册/登录/存本地档），也被 /games/ 大厅用 <script> 引用，
   两边共用同一套 localStorage 键（同源 = 同一份账号数据）。
   云盘：GitHub 私有 Gist / 微软 OneDrive 应用文件夹；绑定后存档才能跨设备。
   设计取舍：游戏本体坚持"单文件 + 离线可玩"，所以账号面板里所有云操作都会在
   未登录/未绑定时给出明确文案，而不是把功能藏起来。 */
import { L } from '../main';
import { integritySummary, isTampered, onSaveWritten, stampInPlace, verifyForeign } from './integrity';
import { isEnvelope } from './account-vault-core';
import { sealMainSlot } from './account-vault';

export const GAME = 'zombie-survival';
export const SLOT = 'main';                    // 主槽：一键上传/下载就是它
const A = () => (typeof window !== 'undefined' ? window.DSHAccount : undefined);
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

let autoSync = false;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let lastCloudWrite = 0;                       // 上次真正写到云端的时间（节流用）
const CLOUD_MIN_INTERVAL = 60000;             // 自动同步最短间隔：别把 KV 当高频存储刷

export const available = () => !!A();
export const currentUser = () => (A()?.current() ?? null);

function providerText(u: NonNullable<ReturnType<typeof currentUser>>): string {
  const g = u.providers.github, m = u.providers.microsoft;
  const parts: string[] = [];
  if (g) parts.push('GitHub @' + g.login);
  if (m) parts.push('微软 ' + m.name);
  return parts.length ? parts.join(' · ') : '未绑定云账号（存档只在这台设备上）';
}

/** 环境面板里那行摘要 */
export function accountSummary(): string {
  const a = A();
  if (!a) return '账号库没加载（这版构建有问题，报告一下）';
  const u = a.current();
  const srv = a.serverInfo?.();
  /* M23：GitHub 账号（没有密码）就说 GitHub 账号，别再说"本机账号" */
  const who = u?.hasPassword === false ? 'GitHub 账号'
    : (srv?.loggedIn === false && u?.server ? '云账号（后端离线，口令按本机兜底）' : (srv?.loggedIn ? '云账号' : '本机账号'));
  if (!u) {
    return srv?.enabled
      ? '未登录 —— 用 GitHub 登录（设备码 / 令牌码），存档进你自己账号下的私有 Gist'
      : '未登录 —— 用 GitHub 登录后存档可以跨设备（本机模式也能玩，存档只在这台设备）';
  }
  const info = a.saveInfo(GAME, SLOT);
  return '已登录 ' + u.name + '（' + who + '） · ' + providerText(u) +
    (info ? ' · 上次上传 ' + info.updatedAt.slice(0, 16).replace('T', ' ') : ' · 还没上传过存档');
}

function toastMsg(title: string, msg: string, kind: 'ok' | 'bad' | 'info' = 'info') {
  try { L.toast(title, msg, kind as never); } catch { /* toast 不可用就忽略 */ }
}

/* ── 面板 ── */
export function openPanel(): void {
  const a = A();
  if (!a) { toastMsg('账号不可用', '这一版没有打进账号模块。', 'bad'); return; }
  const u = a.current();
  const body = u ? loggedInHtml(u, a) : loginHtml();
  L.modal({
    title: '👤 账号与云存档',
    sticky: true,
    body,
    footer: u
      ? '<button class="btn ok" onclick="V4Account.push()">⬆️ 上传存档</button>' +
        '<button class="btn" onclick="V4Account.pull()">⬇️ 下载存档</button>' +
        '<button class="btn" onclick="V4Account.sync()">☁️ 双向同步</button>' +
        (a.cryptoInfo?.().locked ? '<button class="btn" onclick="V4Account.unlock()">🔓 解锁同步</button>' : '') +
        '<button class="btn ghost" onclick="V4Account.toggleAuto()">🔁 自动同步：' + (autoSync ? '开' : '关') + '</button>' +
        '<button class="btn" data-close>关闭</button>'
      : '<button class="btn ok" onclick="V4Account.loginDevice()">📱 设备码登录</button>' +
        '<button class="btn" onclick="V4Account.openTokenBind()">🔑 粘贴令牌码</button>' +
        '<button class="btn ghost" onclick="V4Account.legacyLogin()">旧账号（密码）</button>' +
        '<button class="btn" data-close>关闭</button>',
    onMount() { paint(); },
  });
}

function loginHtml(): string {
  const a = A();
  const keep = a?.rememberedGitHub?.();
  return '<p class="muted">这个游戏<b>不需要注册</b>——账号就是你的 GitHub：登录后存档写进你自己账号下的一个私有 Gist，' +
    '换电脑用同一种方式登录就能接着玩。两种登录方式，任选一种：</p>' +
    '<div class="row" style="margin-top:10px">' +
    '<button class="btn ok" onclick="V4Account.loginDevice()">📱 设备码登录（9 位，最省事）</button>' +
    '<button class="btn" onclick="V4Account.openTokenBind()">🔑 粘贴令牌码登录</button></div>' +
    '<div class="hint" style="margin-top:8px">📱 <b>设备码</b>：点一下会出现一串 9 位码并自动打开 GitHub 授权页，输进去点 Authorize 就完事——不用复制粘贴任何东西。<br>' +
    '🔑 <b>令牌码</b>：自己在 GitHub 建一个只勾 <span class="mono">gist</span> 的令牌粘进来（换电脑、设备码被公司网络挡住时用这条）。</div>' +
    (keep ? '<div class="row" style="margin-top:8px"><button class="btn" onclick="V4Account.loginRemembered()">⚡ 用这台设备记住的 GitHub（@' +
      esc(keep.login || '?') + '）直接进</button></div>' : '') +
    '<div class="hint" style="color:#e0b06a">⚠️ 令牌会记在这台设备的浏览器里（关掉标签页不用重登）；公用电脑上玩完记得点面板里的「解绑」。</div>' +
    '<div class="hint">老的本机账号（带密码的那种）还能进：' +
    '<a href="#" onclick="V4Account.legacyLogin();return false">用密码登录</a>' +
    '（只保留给老账号，<b>不再支持新注册</b>）。</div>' +
    '<div class="hint" id="acc-msg" style="margin-top:8px"></div>';
}

/* ── 恢复码：展示（注册后一次性）/ 补设 / 忘记密码流程 ── */
export function showRecoveryCode(code: string, opts: { fresh?: boolean } = {}): void {
  L.modal({
    title: opts.fresh ? '🎫 抄下你的恢复码' : '🎫 你的新恢复码',
    sticky: true,
    body: '<p class="muted">这串码只在<b>现在</b>显示一次，之后服务端和我们都拿不到明文。</p>' +
      '<div class="mono" style="font-size:19px;letter-spacing:1px;padding:12px;background:#1b1f24;border-radius:8px;' +
      'text-align:center;user-select:all" id="acc-rc-code">' + esc(code) + '</div>' +
      '<div class="hint" style="margin-top:10px">用途：忘了密码时点登录页的「😵 忘记密码」→ 输入用户名 + 这串码 + 新密码，' +
      '云存档原样拿回来（存档密钥是被这串码包住的，服务端自己解不开）。</div>' +
      '<div class="hint">怎么存：抄纸上 / 存手机密码管理器 / 存你自己的加密保险箱。<b>别</b>和游戏账号密码放在同一处。</div>' +
      '<div class="hint">抄错了也不要紧：大小写、连字符、I/L/O/U 都会被自动纠正。</div>',
    footer: '<button class="btn ok" onclick="V4Account.copyRecovery(\'' + esc(code) + '\')">📋 复制</button>' +
      '<button class="btn" data-close>我抄好了</button>',
  });
}
export function copyRecovery(code: string): void {
  try {
    void navigator.clipboard.writeText(code);
    toastMsg('已复制', '粘到你自己存密码的地方，然后清一下剪贴板。', 'ok');
  } catch { toastMsg('复制失败', '手动选中上面那串字符复制。', 'bad'); }
}
export function showRecover(): void {
  L.modal({
    title: '😵 忘记密码：用恢复码找回',
    sticky: true,
    body: '<p class="muted">恢复码是注册时给你的那串 8 组 4 位字母数字。它会解开云存档的密钥，' +
      '所以找回之后<b>存档还在</b>（这一点和普通网站不一样：它们能改密码，但救不回加密数据）。</p>' +
      '<div class="row" style="margin-top:10px"><input id="acc-rc-name" placeholder="用户名" style="flex:1"></div>' +
      '<div class="row" style="margin-top:8px"><input id="acc-rc-code2" placeholder="恢复码（如 R3J7-6DAM-…）" style="flex:1"></div>' +
      '<div class="row" style="margin-top:8px"><input id="acc-rc-pass" type="password" placeholder="新密码（≥6 位）" style="flex:1"></div>' +
      '<div class="hint" style="margin-top:8px">没设过恢复码的账号找回不了（服务端只有口令哈希，没有任何后门）——' +
      '这种账号只能重开一局（本机存档是加密的，没有"导出明文"这条路可走）。</div>' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.doRecover()">找回并设置新密码</button>' +
      '<button class="btn" data-close>取消</button>',
  });
}
export async function doRecover(): Promise<boolean> {
  const a = A(); if (!a) return false;
  msg('正在用恢复码解开存档密钥…（本机 PBKDF2 21 万轮，几秒）');
  const r = await a.recover({ name: val('#acc-rc-name'), code: val('#acc-rc-code2'), password: val('#acc-rc-pass') });
  if (!r.ok) { msg(r.err ?? '找回失败', true); return false; }
  L.log('🎫 已用恢复码找回账号：' + r.user?.name + '（云存档没丢）', 'success');
  L.closeAllModals(); openPanel(); L.render();
  return true;
}
/** 已登录状态下补设恢复码（老账号升级用） */
export async function setupRecovery(): Promise<void> {
  const a = A(); if (!a) return;
  msg('正在生成恢复码…');
  const r = await a.setRecovery();
  if (!r.ok || !r.code) { msg(r.err ?? '生成失败', true); return; }
  showRecoveryCode(r.code, { fresh: false });
}

function loggedInHtml(u: NonNullable<ReturnType<typeof currentUser>>, a: NonNullable<ReturnType<typeof A>>): string {
  const g = u.providers.github, m = u.providers.microsoft;
  const info = a.saveInfo(GAME, SLOT);
  const srv = a.serverInfo?.();
  const backend = srv?.loggedIn ? 'server' : (g ? 'github' : (m ? 'microsoft' : null));
  let h = '<p class="muted">已登录：<b>' + esc(u.name) + '</b>' + (u.email ? '（' + esc(u.email) + '）' : '') +
    ' · ' + (u.hasPassword ? '本机账号（带密码）' : 'GitHub 账号（没有密码）') + ' · ' +
    (g && g.login ? 'GitHub @' + esc(g.login) : '未绑定 GitHub') + '</p>';
  h += '<div class="hint">存档去向：' +
    (backend === 'server' ? '你自己的 Cloudflare（Worker + KV）'
      : backend === 'github' ? 'GitHub 私有 Gist（你自己的账号下）'
        : backend === 'microsoft' ? 'OneDrive 应用文件夹'
          : '只在这台设备（浏览器本地）—— 想跨设备就登录 GitHub（设备码或令牌码）') + '</div>';
  // 加密状态：云模式下上传的是密文，密钥由口令派生、只留在本标签页
  if (backend === 'server') {
    const ci = a.cryptoInfo?.();
    h += '<div class="hint">🔐 上传前在本机加密（' + esc(ci?.alg ?? 'AES-GCM') + '，随机 IV，密文带版本头）：' +
      (ci?.locked ? '<b>当前未解锁</b> —— 点下面的「🔓 解锁同步」输入一次口令即可（口令不会上传）'
        : '已解锁（密钥只在本标签页内存里，关掉即失效）') + '</div>';
  }
  if (g && g.serverSide !== false) h += '<div class="hint">GitHub 令牌保存在 Worker 里（前端拿不到），中继只允许读写你名下那一个存档 Gist。</div>';
  h += '<div class="sect-title" style="margin-top:12px">云存档（GitHub 私有 Gist）</div><div class="row">';
  h += g
    ? '<button class="btn ok" onclick="V4Account.unbind(\'github\')">GitHub @' + esc(g.login) + ' ✕</button>'
    : '<button class="btn" onclick="V4Account.openTokenBind()">🔑 贴令牌码开启云存档</button>';
  // 微软这条要先在 Azure 注册应用，而个人微软账号会被要求绑信用卡 —— 没配 clientId 就干脆不显示按钮，
  // 免得点了一下只看到错误（见 auth-config.js 顶部记录）。
  if (a.config().microsoft.clientId) {
    h += m
      ? '<button class="btn ok" onclick="V4Account.unbind(\'microsoft\')">微软 ' + esc(m.name) + ' ✕</button>'
      : '<button class="btn" onclick="V4Account.bindMicrosoft()">🪟 绑定微软账号</button>';
  }
  h += '</div>';
  if (!g && !m) h += '<div class="hint">没绑定云账号也能玩：进度加密存在这台设备的浏览器里。' +
    '想跨设备就贴一次 GitHub 令牌码——存档（密文）会写进你自己账号下的一个私有 Gist，随时能删。</div>';
  if (!a.config().microsoft.clientId) h += '<div class="hint">微软那条路暂时没有：它要求在 Azure 注册应用，' +
    '而个人微软账号走注册流程时被要求绑信用卡。GitHub 一条够用（免费、无额度限制）。</div>';
  if (g && g.serverSide) h += '<div class="hint">令牌保存在你自己的 Worker 里（前端拿不到），中继只允许读写你名下那一个存档 Gist。</div>';
  if (g && !g.serverSide) h += '<div class="hint">令牌记在这台设备的浏览器里（localStorage，关标签页不用重登），' +
    '除了 api.github.com 不向别处发请求；点上面的「✕」解绑就会清掉它，也可在 GitHub → Settings → Developer settings → Tokens 删掉。</div>';
  if (g) h += '<div class="hint">GitHub 云盘 = 一个私有 Gist（描述里写着 bobbychina.github.io/games），删除 gist 就等于删云端存档。</div>';
  if (m) h += '<div class="hint">微软云盘 = OneDrive 的「应用文件夹 /dsh-saves」，不占用你可见的文档目录。</div>';
  /* 今日上传额度：服务端每账号每天 10 次（免费版 KV 每天只有 1000 次写），挂载后异步填进来 */
  if (backend === 'server') h += '<div class="hint" id="acc-quota">☁️ 今日云上传额度：查询中…</div>';
  /* 恢复码是"带密码的本机/云账号"才有的东西：GitHub 账号没有密码，显示它只会让人困惑 */
  if (u.hasPassword) h += '<div class="hint">🎫 恢复码：<span id="acc-rc-state">…</span></div>';
  h += '<div class="sect-title" style="margin-top:12px">本机存档（槽位 main）</div>';
  h += '<div class="hint">' + (info ? '本机 ' + esc(info.updatedAt.slice(0, 16).replace('T', ' ')) + ' · ' + Math.round(info.bytes / 1024) + ' KB'
    : '还没有上传过（点下面的「上传存档」把当前进度存进账号）') + '</div>';
  // M8：存档完整性（指纹校验的结果直接摆在这里，别让玩家以为"改了没人知道"）
  h += '<div class="hint">🔒 ' + esc(integritySummary()) + '</div>';
  h += '<div class="sect-title" style="margin-top:12px">账号操作</div><div class="row">' +
    (u.hasPassword ? '<button class="btn" onclick="V4Account.changePass()">🔑 改密码</button>' +
      '<button class="btn" onclick="V4Account.setupRecovery()">🎫 设/换恢复码</button>' : '') +
    '<button class="btn" onclick="V4Account.logout()">🚪 退出登录</button>' +
    '<button class="btn danger" onclick="V4Account.del()">🗑️ 注销账号</button></div>';
  /* M29：不再提供"导出明文存档" —— 想换设备/多端同步就用上面的「上传存档 / 读取存档 / 同步」，
     上云与本机落盘的都是密文（本机 `ZSV1:`，账号库 `ZSV2:`）。 */
  h += '<div class="hint" style="color:#e0b06a">🔒 存档不再支持「导出明文文件」：本机与云上都是密文' +
    '（换设备请登录同一个账号，用上面的「上传存档 / 读取存档」；本机写坏可回滚加密备份）。</div>';
  h += '<div class="hint" id="acc-msg" style="margin-top:8px"></div>';
  return h;
}

function paint() {
  const box = L.$('#acc-msg') as HTMLElement | null;
  if (box) box.textContent = '';
  void paintQuota();
}
/** 异步补上"今日额度"和"恢复码状态"两行（面板先渲染，数据后到） */
async function paintQuota(): Promise<void> {
  const a = A(); if (!a) return;
  const qBox = L.$('#acc-quota') as HTMLElement | null;
  const rcBox = L.$('#acc-rc-state') as HTMLElement | null;
  if (qBox) {
    const q = await a.quota();
    if (q.ok) {
      const left = q.left ?? 0, limit = q.limit ?? 10;
      const reset = q.resetAt ? q.resetAt.slice(11, 16) : '';
      qBox.textContent = '☁️ 今日云上传额度：还剩 ' + left + ' / ' + limit + ' 次' +
        (reset ? '（UTC+8 ' + reset + ' 后重置）' : '') +
        (left === 0 ? ' —— 明天的额度到了再传，本地存档不受影响' : '');
    } else if (!q.local) {
      qBox.textContent = '☁️ 今日云上传额度：查询失败（' + (q.err ?? '') + '）';
    } else {
      qBox.textContent = '☁️ 今日云上传额度：本机账号没有额度限制（也不会上云）';
    }
  }
  if (rcBox) {
    const info = a.serverInfo?.() as { hasRecovery?: boolean } | undefined;
    if (info && info.hasRecovery === false) {
      rcBox.innerHTML = '<b>还没设</b> —— 忘了密码就找不回云存档，点下面的「🎫 设/换恢复码」补一个';
    } else if (info && info.hasRecovery) {
      rcBox.textContent = '已设置（服务端只存校验值，明文只有你手里那份）';
    } else {
      rcBox.textContent = '本机账号：没设恢复码就找不回（存档是加密的，密文换账号解不开）';
    }
  }
}
function msg(text: string, bad = false) {
  const box = L.$('#acc-msg') as HTMLElement | null;
  if (box) { box.textContent = text; box.style.color = bad ? '#e0736a' : '#7fd6a5'; }
}
const val = (sel: string) => String((L.$(sel) as HTMLInputElement | null)?.value ?? '').trim();

/* ── 登录 / 注册 ──
   M23：UI 上**没有注册**了（账号 = GitHub，见 loginDevice/openTokenBind）。
   doLogin 只给"旧的本机账号（带密码）"用，入口是登录页那行小字（legacyLogin）。 */
export async function doLogin(): Promise<boolean> {
  const a = A(); if (!a) return false;
  const r = await a.login({ name: val('#acc-name'), password: val('#acc-pass') });
  if (!r.ok) { msg(r.err ?? '登录失败', true); return false; }
  L.log('👤 已登录：' + r.user?.name, 'success');
  L.closeAllModals(); openPanel(); L.render();
  return true;
}
export function logout(): void {
  A()?.logout();
  L.closeAllModals(); L.render();
  toastMsg('已退出登录', '存档还在这台设备上，重新登录就能继续用。', 'info');
}

/* ── M23：GitHub 即账号——登录只有两条路：设备码 / 令牌码 ── */

/** 设备码登录：出 9 位码 → 自动打开 GitHub 授权页 → 这边轮询拿到令牌 → 进号（没有账号就自动建）。
    中继不可达时**快速失败**，并把「令牌码」这条能走的路直接摆在面前（实测校园网会把 workers.dev 整个屏蔽）。 */
export async function loginDevice(): Promise<void> {
  const a = A(); if (!a) return;
  const wait = L.modal({
    title: '📱 正在向 GitHub 申请设备码…',
    sticky: true,
    body: '<p class="muted">请求只发给 GitHub（或你自己的中继），几秒就回来。</p>' +
      '<div class="hint" id="acc-msg">等 9 位码出现…</div>',
    footer: '<button class="btn" data-close>取消</button>',
  });
  const r = await a.signInGitHubDevice(info => { L.closeModal(wait); deviceCodeModal(info); });
  if (!r.ok) { L.closeModal(wait); deviceFailModal(r.err ?? '设备码没成功'); return; }
  loginDone(r);
}
/** 设备码失败：说清原因 + 给两条出路（改用令牌码 / 重试） */
function deviceFailModal(err: string): void {
  L.modal({
    title: '📱 设备码这条路走不通',
    sticky: true,
    body: '<p class="muted">原因：' + esc(err) + '</p>' +
      '<div class="hint">设备码在浏览器里必须经过一个小中继（GitHub 的换 token 接口不给跨域头），' +
      '所以中继被网络挡住、或还没部署时这条路就断了——这不是你的操作问题。</div>' +
      '<div class="hint">换条路：<b>🔑 令牌码</b>——在 GitHub 建一个只勾 <span class="mono">gist</span> 的令牌粘进来，3 步就好，' +
      '而且不依赖任何中继。</div>',
    footer: '<button class="btn ok" onclick="closeAllModals();V4Account.openTokenBind()">🔑 改用令牌码</button>' +
      '<button class="btn" onclick="closeAllModals();V4Account.loginDevice()">再试一次</button>' +
      '<button class="btn" data-close>知道了</button>',
  });
}
/** 这台设备上次记住的令牌还在 → 一键回来 */
export async function loginRemembered(): Promise<void> {
  const a = A(); if (!a) return;
  msg('正在用记住的令牌登录……');
  const r = await a.signInGitHubRemembered();
  if (!r.ok) { toastMsg('记住的令牌不能用了', (r.err ?? '') + '　换设备码或令牌码登录即可。', 'bad'); msg(r.err ?? '登录失败', true); return; }
  loginDone(r);
}
/** 登录成功：关掉所有弹窗、刷新面板与界面 */
function loginDone(r: { user?: { name?: string } }): void {
  L.log('👤 已用 GitHub 登录：' + (r.user?.name ?? '?') + '（云存档 = 你自己账号下的私有 Gist）', 'success');
  L.closeAllModals(); openPanel(); L.render();
}
/** 设备码提示框：9 位码放最显眼处 + 自动打开授权页（不用复制粘贴任何东西） */
function deviceCodeModal(info: { user_code: string; verification_uri: string }): void {
  L.modal({
    title: '📱 在 GitHub 输入这 9 位',
    sticky: true,
    body: '<p class="muted">已自动打开 GitHub 的授权页；把这串输进去点 <b>Authorize</b>，这边会自己完成登录（不用回来点任何东西）。</p>' +
      '<div class="mono" style="font-size:30px;letter-spacing:5px;text-align:center;color:#7fd6a5;margin:16px 0" id="acc-dev-code">' + esc(info.user_code) + '</div>' +
      '<div class="hint">页面没自动打开？手动访问 <b>' + esc(info.verification_uri) + '</b> 再输这串码。</div>' +
      '<div class="hint" id="acc-msg"></div>',
    footer: '<button class="btn" onclick="window.open(\'' + esc(info.verification_uri) + '\',\'_blank\')">打开 GitHub 授权页</button>' +
      '<button class="btn" data-close>稍后再说</button>',
  });
  try { window.open(info.verification_uri, '_blank'); } catch { /* 被拦就算了，弹窗里有按钮 */ }
}
/** 老的本机账号（带密码）：只保留入口，不提供注册 */
export function legacyLogin(): void {
  L.modal({
    title: '🔑 旧的本机账号登录',
    sticky: true,
    body: '<p class="muted">这是给<b>以前注册过带密码账号</b>的玩家留的入口——现在的新账号一律走 GitHub（设备码 / 令牌码），不再支持注册。</p>' +
      '<div class="row" style="margin-top:10px"><input id="acc-name" placeholder="用户名" style="flex:1">' +
      '<input id="acc-pass" type="password" placeholder="密码" style="flex:1"></div>' +
      '<div class="row" style="margin-top:8px"><button class="btn ghost" onclick="V4Account.showRecover()">😵 忘记密码 / 用恢复码登录</button></div>' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.doLogin()">登录</button>' +
      '<button class="btn" data-close>取消</button>',
  });
}

/* ── 云存档 = 贴一次令牌码（M22） ──
   用户原话："好何意味的绑定，改成直接用令牌码"——所以 OAuth 一键授权、设备码、诊断三种入口全删：
     · 一键授权在纯静态站（GitHub Pages）本来就走不通：GitHub 的 code 换 token 接口不给跨域头，
       除非自建带 client_secret 的中继——为存个档搭服务端不值得；
     · 设备码要多跳两次页面，还只在勾了 Device Flow 的 OAuth App 上可用；
     · 令牌码 3 步就能用，而且"给什么权限、存在哪、怎么收回"都能在一个弹窗里说清。
   权限披露没有省：gist 是全量授权这件事仍然明写在弹窗里。 */
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=' +
  encodeURIComponent('bobbychina.github.io/games 云存档');

/** 令牌码弹窗（云存档唯一的开启方式） */
export function openTokenBind(): void {
  const a = A(); if (!a) return;
  const serverSide = !!a.config().api;      // 配了中继 = 令牌交给自己的 Worker 保存，前端不留
  const loggedIn = !!a.current();
  L.modal({
    title: loggedIn ? '🔑 贴令牌码，开启云存档' : '🔑 用令牌码登录',
    sticky: true,
    body: '<div class="hint">云存档 = 你 GitHub 账号下的<b>一个私有 Gist</b>。三步：' +
      '① 点下面按钮打开令牌页（<span class="mono">gist</span> 权限已勾好）→ ② 点 <b>Generate token</b> 复制 → ③ 粘进框里点「' +
      (loggedIn ? '保存并启用' : '登录') + '」。</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn" onclick="window.open(\'' + TOKEN_URL + '\',\'_blank\')">🔗 打开 GitHub 令牌页</button></div>' +
      '<input id="acc-gh-token" placeholder="粘贴令牌码（ghp_… / github_pat_…）" style="width:100%;margin-top:8px">' +
      '<div class="hint" style="margin-top:8px">权限只有 <span class="mono">gist</span>：读写你账号下的 Gist。' +
      'GitHub 没有"只授权某一个 Gist"的粒度，但令牌碰不到你的仓库、代码、issue 与密码。</div>' +
      '<div class="hint">存在哪：' + (serverSide
        ? '发给<b>你自己的 Cloudflare Worker</b>保存（前端不留令牌），中继只允许读写你名下那一个存档 Gist。'
        : '只在这台设备的浏览器（localStorage）——本站没有后端，除了 api.github.com 不向别处发请求；公用电脑上别贴。') + '</div>' +
      '<div class="hint">怎么收回：GitHub → Settings → Developer settings → Tokens 里删掉它（本地存档不受影响）；云端存档就是那个 Gist。' +
      '面板上点「GitHub @你 ✕」也能解绑。</div>' +
      '<div class="hint" style="color:#e0b06a">⚠️ 不想给令牌？关掉窗口也能玩：进度加密存在本机（只是没法跨设备）。</div>' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.bindGitHubToken()">' + (loggedIn ? '保存并启用' : '登录并启用云存档') + '</button>' +
      '<button class="btn" data-close>取消</button>',
  });
}
export async function bindGitHubToken(): Promise<void> {
  const a = A(); if (!a) return;
  const t = val('#acc-gh-token');
  if (!t) { msg('先把令牌码粘进来', true); return; }
  msg('正在校验令牌……');
  /* 没登录时这一步就是"登录"：校验令牌 → 建号/进号（账号 = GitHub）；已登录则等同绑定 */
  const r = a.current() ? await a.bindGitHubToken(t) : await a.signInGitHub(t);
  afterBind(r, 'github');
}
export async function bindMicrosoft(): Promise<void> {
  const a = A(); if (!a) return;
  const c = a.config();
  if (!c.microsoft.clientId) {
    msg('还没配置微软 client_id：把 Azure 应用注册里的 Application (client) ID 填进 /games/auth-config.js（README 有 3 步图文）', true);
    return;
  }
  msg('正在打开微软登录页……');
  const r = await a.bindMicrosoft();
  afterBind(r, 'microsoft');
}
function afterBind(r: { ok: boolean; err?: string }, provider: string) {
  if (!r.ok) {
    toastMsg(provider === 'github' ? '云存档没启用' : '绑定失败', r.err ?? '', 'bad');
    msg(r.err ?? '绑定失败', true);
    return;
  }
  L.log('☁️ 已' + (provider === 'github' ? '开启 GitHub 云存档' : '绑定微软账号') + '，存档可以同步到云端了。', 'success');
  L.closeAllModals(); openPanel(); L.render();
}

export function unbind(provider: 'github' | 'microsoft'): void {
  void (async () => {
    const r = await A()?.unbind(provider);
    L.closeAllModals(); openPanel();
    if (r?.note) toastMsg('已解绑', String(r.note), 'info');
  })();
}

/* ── 解锁：重新输入一次口令，在本机重新派生加密密钥（口令不上传） ── */
export function unlock(): void {
  L.modal({
    title: '🔓 解锁云同步', sticky: true,
    body: '<p class="muted">云端的存档是加密的，密钥由你的口令在本机派生。' +
      '换设备/重开标签页后需要重新输入一次口令来解锁——<b>口令不会被发送到任何地方</b>，只用来在本机算出密钥。</p>' +
      '<input id="acc-unlock" type="password" placeholder="账号口令" style="width:100%;margin-top:10px">' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.doUnlock()">解锁</button><button class="btn" data-close>取消</button>',
  });
}
export async function doUnlock(): Promise<void> {
  const a = A(); if (!a) return;
  msg('正在本机派生密钥…');
  const r = await a.unlock(val('#acc-unlock'));
  if (!r.ok) { msg(r.err ?? '解锁失败', true); return; }
  L.closeAllModals(); openPanel();
  toastMsg('已解锁', '本次会话内可以直接同步了。', 'ok');
}

/* ── 存档上传 / 下载 ── */
export function push(): void { void pushAsync(); }
async function pushAsync(): Promise<void> {
  const a = A(); if (!a) return;
  const u = a.current();
  if (!u) { toastMsg('先登录', '没登录时存档只在本机，登录后才能带账号走。', 'bad'); return; }
  stampInPlace(L.S as Record<string, unknown>);          // 盖指纹：云端那份才能校验通过
  /* noServer：savePut 默认会自己异步推一次云；这里紧接着就 pushAll，不关掉会同一份存两次
     —— 每账号每天只有 10 次上传额度，白烧一半 */
  const r = a.savePut(GAME, SLOT, L.S, { noServer: true });
  if (!r.ok) { toastMsg('存档失败', r.err ?? '', 'bad'); return; }
  await sealMainSlot(GAME);                              // M29：确认磁盘上那份已是密文（上传走它）
  const up = await a.pushAll(GAME);
  if (up.ok) toastMsg('已存档到账号', '本机 + ' + (up.provider === 'github' ? 'GitHub Gist' : 'OneDrive') + ' 都写好了。', 'ok');
  else toastMsg('只存到了本机', up.err ?? '绑定云账号后才能跨设备。', 'info');
  L.closeAllModals(); openPanel();
}
export function pull(): void { void pullAsync(); }
async function pullAsync(): Promise<void> {
  const a = A(); if (!a) return;
  const u = a.current();
  if (!u) { toastMsg('先登录', '', 'bad'); return; }
  const down = await a.pullAll(GAME);
  const data = a.saveGet(GAME, SLOT);
  if (!data) { toastMsg('账号里没有存档', down.ok ? '云端和本机都没有这一槽。' : (down.err ?? ''), 'bad'); return; }
  /* M29：账号库里存的是密文串；pullAll 的钩子已经把它解进内存了，这里拿到的应该是明文对象。
     万一还是密文（密钥没准备好），提示一下而不是假装成功。 */
  if (isEnvelope(data)) { toastMsg('存档还没解密好', '稍等一秒再点一次「读取账号存档」。', 'info'); return; }
  if (!applySave(data)) { toastMsg('这份存档读不了', '可能来自更新的版本。', 'bad'); return; }
  toastMsg('已读取账号存档', down.ok ? '来源：' + (down.provider === 'github' ? 'GitHub' : 'OneDrive') : '来源：本机', 'ok');
}
export function sync(): void { void syncAsync(); }
async function syncAsync(): Promise<void> {
  const a = A(); if (!a) return;
  if (!a.current()) { toastMsg('先登录', '', 'bad'); return; }
  const r = await a.syncNow(GAME);
  if (!r.ok) { toastMsg('同步失败', r.err ?? '', 'bad'); return; }
  if (r.pulled?.length) applySave(a.saveGet(GAME, SLOT));
  L.log('☁️ 同步完成：下拉 ' + (r.pulled?.join('、') || '无') + ' · 上传 ' + (r.pushed?.join('、') || '无'), 'info');
  toastMsg('同步完成', '下拉 ' + (r.pulled?.length ?? 0) + ' 个 · 上传 ' + (r.pushed?.length ?? 0) + ' 个', 'ok');
  L.closeAllModals(); openPanel();
}
export function toggleAuto(): void {
  autoSync = !autoSync;
  toastMsg('自动同步：' + (autoSync ? '开' : '关'), autoSync ? '之后每次自动保存都会推到云盘（节流 8 秒）。' : '改回手动上传/下载。', 'info');
  L.closeAllModals(); openPanel();
}
export const isAutoSync = () => autoSync;

/** 把账号里的存档放回游戏（走 legacy 的 sanitize，坏档不放进来）
 *  M8：放进来之前先验指纹——云端那份如果在 Gist 网页上被人手改过，这里要拦一下并问玩家 */
export function applySave(data: unknown): boolean {
  try {
    /* M29：密文串不是存档对象 —— 先让调用方的异步钩子解出来，别在这里当成坏档 */
    if (isEnvelope(data)) { L.log('🔐 这份存档还是密文，稍等解密完成再点一次。', 'dim'); return false; }
    const v = verifyForeign(data);
    if (v.tampered) {
      const go = window.confirm('这份存档的指纹对不上（' + v.detail + '）。\n\n' +
        '可能是你在 GitHub 网页上手动改过，或者同步坏了。\n' +
        '点「确定」= 仍然载入（本档成就/排行不再计入）；点「取消」= 保留本机进度。');
      if (!go) { toastMsg('已取消载入', '本机进度没动。', 'info'); return false; }
      L.log('⚠️ 载入了一份被外部修改过的存档：' + v.detail, 'danger');
    }
    const clean = L.sanitizeSave(data as never);
    if (!clean) return false;
    L.S = clean;
    L.battle = null;
    L.closeAllModals();
    L.render();
    L.autosave();
    return true;
  } catch (e) { console.warn('[v4] 应用账号存档失败', e); return false; }
}

/* ── 改密 / 删号 ──
   M29：这里原来有「导出全部存档 / 导出存档文件 / 从文件导入 / 导入存档」四个入口，
   现在**全部删掉**（用户：「不做可直接导出存档」）。换设备的唯一正路 = 登录同一账号 +
   ☁️ 上传/读取（本机落盘 `ZSV1:`、账号库落盘与 Gist/OneDrive `ZSV2:`，都是密文）。 */
/** 给面板/菜单提示用：M29 之后存档只在"本机加密存档"与"账号云存档"两条路上跑 */
export const EXPORT_REMOVED_HINT = 'M29 起不再提供明文导出：换设备用账号云存档（上传的也是密文）。';

export function changePass(): void {
  L.modal({
    title: '🔑 改密码', sticky: true,
    body: '<div class="row"><input id="acc-old" type="password" placeholder="原密码" style="flex:1">' +
      '<input id="acc-new" type="password" placeholder="新密码（≥6 位）" style="flex:1"></div>' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.doChangePass()">确认修改</button><button class="btn" data-close>取消</button>',
  });
}
export async function doChangePass(): Promise<void> {
  const a = A(); if (!a) return;
  const r = await a.changePassword(val('#acc-old'), val('#acc-new'));
  if (!r.ok) { msg(r.err ?? '修改失败', true); return; }
  L.closeAllModals();
  toastMsg('密码已修改', '下次登录用新密码。', 'ok');
}
export function del(): void {
  L.modal({
    title: '🗑️ 注销账号', sticky: true,
    body: '<p class="muted">会删掉本机上的账号与它名下的存档（云端 gist / OneDrive 里的文件要你自己去删）。' +
      '确认的话，把账号名原样敲进下面的框。</p><input id="acc-del" placeholder="输入账号名" style="width:100%;margin-top:8px">' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn danger" onclick="V4Account.doDelete()">确认注销</button><button class="btn" data-close>取消</button>',
  });
}
export function doDelete(): void {
  const a = A(); if (!a) return;
  const r = a.deleteAccount(val('#acc-del'));
  if (!r.ok) { msg(r.err ?? '注销失败', true); return; }
  L.closeAllModals(); L.render();
  toastMsg('账号已注销', '本机存档也一起清掉了。', 'info');
}

/* ── 自动同步：订阅"存档真的落盘了"（不能包 legacy 的 autosave——它是一个 IIFE，
      内部调用走的是闭包里的局部函数，改 window 属性拦不到；这个坑已经踩过一次） ── */
export function subscribeAutoSync(): void {
  onSaveWritten(() => {
    const a = A();
    if (!autoSync || !a?.current()) return;
    const fire = () => {
      autoTimer = null;
      lastCloudWrite = Date.now();
      try {
        stampInPlace(L.S as Record<string, unknown>);      // 先盖指纹再上传，云端那份才校验得通过
        a.savePut(GAME, SLOT, L.S, { noServer: true });    // 同上：别让 savePut 和 pushAll 各推一次（额度翻倍消耗）
        void sealMainSlot(GAME).then(() => a.pushAll(GAME)).then(res => {   // M29：先确认落盘是密文，再上云
          if (res.ok) L.log('☁️ 自动同步：存档已推到云端。', 'dim');
        });
      } catch (e) { console.warn('[v4] 自动同步失败', e); }
    };
    /* 两段节流：先 debounce 8 秒（连续几次保存合并成一次），
       再保证距上次写云至少 60 秒——KV 每天只有 1000 次写，别按"每存一次就写一次"来。 */
    if (autoTimer) clearTimeout(autoTimer);
    const sinceLast = Date.now() - lastCloudWrite;
    autoTimer = setTimeout(fire, Math.max(8000, CLOUD_MIN_INTERVAL - sinceLast));
  });
}
