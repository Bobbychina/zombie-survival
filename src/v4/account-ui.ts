/* M8 · 账号与云存档（游戏侧界面）
   ---------------------------------------------------------------------------
   账号库本体在 src/account/account.js：原生 JS、零依赖，同一份文件既被这里的
   单文件构建打进游戏（离线也能注册/登录/存本地档），也被 /games/ 大厅用 <script> 引用，
   两边共用同一套 localStorage 键（同源 = 同一份账号数据）。
   云盘：GitHub 私有 Gist / 微软 OneDrive 应用文件夹；绑定后存档才能跨设备。
   设计取舍：游戏本体坚持"单文件 + 离线可玩"，所以账号面板里所有云操作都会在
   未登录/未绑定时给出明确文案，而不是把功能藏起来。 */
import { L } from '../main';

export const GAME = 'zombie-survival';
export const SLOT = 'main';                    // 主槽：一键上传/下载就是它
const A = () => (typeof window !== 'undefined' ? window.DSHAccount : undefined);
const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

let autoSync = false;
let autoTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (!u) return '未登录 —— 登录后存档可以跟着账号走（可绑定 GitHub / 微软账号）';
  const info = a.saveInfo(GAME, SLOT);
  return '已登录 ' + u.name + ' · ' + providerText(u) +
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
        '<button class="btn ghost" onclick="V4Account.toggleAuto()">🔁 自动同步：' + (autoSync ? '开' : '关') + '</button>' +
        '<button class="btn" data-close>关闭</button>'
      : '<button class="btn ok" onclick="V4Account.doRegister()">注册并登录</button>' +
        '<button class="btn" onclick="V4Account.doLogin()">登录</button>' +
        '<button class="btn" data-close>取消</button>',
    onMount() { paint(); },
  });
}

function loginHtml(): string {
  return '<p class="muted">账号只为了两件事：<b>让存档跟着你走</b>、<b>在别的电脑上接着玩</b>。' +
    '注册不需要邮箱验证，密码只保存在本机（WebCrypto 加盐哈希），我们服务器上一份数据都没有。</p>' +
    '<div class="row" style="margin-top:10px"><input id="acc-name" placeholder="用户名（2~24 字）" style="flex:1">' +
    '<input id="acc-pass" type="password" placeholder="密码（≥6 位）" style="flex:1"></div>' +
    '<div class="row" style="margin-top:8px"><input id="acc-mail" placeholder="邮箱（选填，只用来认账号）" style="flex:1"></div>' +
    '<div class="hint" id="acc-msg" style="margin-top:8px"></div>';
}

function loggedInHtml(u: NonNullable<ReturnType<typeof currentUser>>, a: NonNullable<ReturnType<typeof A>>): string {
  const g = u.providers.github, m = u.providers.microsoft;
  const info = a.saveInfo(GAME, SLOT);
  let h = '<p class="muted">已登录：<b>' + esc(u.name) + '</b>' + (u.email ? '（' + esc(u.email) + '）' : '') +
    ' · 注册于 ' + esc(u.createdAt.slice(0, 10)) + '</p>';
  h += '<div class="sect-title" style="margin-top:12px">云账号绑定</div><div class="row">';
  h += g
    ? '<button class="btn ok" onclick="V4Account.unbind(\'github\')">GitHub @' + esc(g.login) + ' ✕</button>'
    : '<button class="btn" onclick="V4Account.bindGitHub()">🐙 绑定 GitHub 账号</button>';
  // 微软这条要先在 Azure 注册应用，而个人微软账号会被要求绑信用卡 —— 没配 clientId 就干脆不显示按钮，
  // 免得点了一下只看到错误（见 auth-config.js 顶部记录）。
  if (a.config().microsoft.clientId) {
    h += m
      ? '<button class="btn ok" onclick="V4Account.unbind(\'microsoft\')">微软 ' + esc(m.name) + ' ✕</button>'
      : '<button class="btn" onclick="V4Account.bindMicrosoft()">🪟 绑定微软账号</button>';
  }
  h += '</div>';
  if (!g && !m) h += '<div class="hint">没绑云账号也能用：存档按账号存在这台设备的浏览器里，用下面的「导出存档文件」能拷到别的设备。' +
    '绑 GitHub 之后存档会同步到你自己账号下的私有 Gist，随时能删。</div>';
  if (!a.config().microsoft.clientId) h += '<div class="hint">微软登录这条路暂时没有：它要求在 Azure 注册应用，而个人微软账号走注册流程时被要求绑信用卡。' +
    'GitHub 一条就够用（免费、无额度限制）。</div>';
  if (g) h += '<div class="hint">GitHub 云盘 = 一个私有 Gist（描述里写着 bobbychina.github.io/games），删除 gist 就等于删云端存档。</div>';
  if (m) h += '<div class="hint">微软云盘 = OneDrive 的「应用文件夹 /dsh-saves」，不占用你可见的文档目录。</div>';
  h += '<div class="sect-title" style="margin-top:12px">本机存档（槽位 main）</div>';
  h += '<div class="hint">' + (info ? '本机 ' + esc(info.updatedAt.slice(0, 16).replace('T', ' ')) + ' · ' + Math.round(info.bytes / 1024) + ' KB'
    : '还没有上传过（点下面的「上传存档」把当前进度存进账号）') + '</div>';
  h += '<div class="sect-title" style="margin-top:12px">账号操作</div><div class="row">' +
    '<button class="btn" onclick="V4Account.changePass()">🔑 改密码</button>' +
    '<button class="btn" onclick="V4Account.exportFile()">💾 导出存档文件</button>' +
    '<button class="btn" onclick="V4Account.importFile()">📂 从文件导入</button>' +
    '<button class="btn ghost" onclick="V4Account.exportAll()">⬆️ 导出文本</button>' +
    '<button class="btn" onclick="V4Account.logout()">🚪 退出登录</button>' +
    '<button class="btn danger" onclick="V4Account.del()">🗑️ 注销账号</button></div>';
  h += '<div class="hint" id="acc-msg" style="margin-top:8px"></div>';
  return h;
}

function paint() {
  const box = L.$('#acc-msg') as HTMLElement | null;
  if (box) box.textContent = '';
}
function msg(text: string, bad = false) {
  const box = L.$('#acc-msg') as HTMLElement | null;
  if (box) { box.textContent = text; box.style.color = bad ? '#e0736a' : '#7fd6a5'; }
}
const val = (sel: string) => String((L.$(sel) as HTMLInputElement | null)?.value ?? '').trim();

/* ── 登录 / 注册 ── */
export async function doRegister(): Promise<boolean> {
  const a = A(); if (!a) return false;
  const r = await a.register({ name: val('#acc-name'), password: val('#acc-pass'), email: val('#acc-mail') });
  if (!r.ok) { msg(r.err ?? '注册失败', true); return false; }
  L.log('👤 账号已创建：' + r.user?.name + '（存档会跟着这个账号走）', 'success');
  L.closeAllModals(); openPanel(); L.render();
  return true;
}
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

/* ── 云账号绑定 ── */
export async function bindGitHub(): Promise<void> {
  const a = A(); if (!a) return;
  const c = a.config();
  if (!c.github.clientId) {
    // 没配 client_id 时给出"零注册"的兜底路：浏览器里生成一个只带 gist 权限的令牌
    L.modal({
      title: '🐙 绑定 GitHub',
      sticky: true,
      body: '<p class="muted">两条路都行，任选一条：</p>' +
        '<div class="sect-title" style="margin-top:10px">A · 一键授权（推荐）</div>' +
        '<div class="hint">还没配置 client_id，所以一键授权暂时不可用——把 OAuth App 的 client_id 填进 ' +
        '<span class="mono">/games/auth-config.js</span> 就会自动启用（README 有 3 步图文）。</div>' +
        '<div class="sect-title" style="margin-top:10px">B · 令牌绑定（现在就能用，2 次点击）</div>' +
        '<div class="hint">点下面的按钮 → GitHub 会打开「新建令牌」页并勾好 <span class="mono">gist</span> 权限 → ' +
        '点 Generate token → 复制粘贴到下面。令牌只存在你这台设备的浏览器里，随时可在 GitHub 设置里撤销。</div>' +
        '<div class="row" style="margin-top:8px">' +
        '<button class="btn" onclick="window.open(\'https://github.com/settings/tokens/new?scopes=gist&description=bobbychina.github.io%2Fgames%20%E4%BA%91%E5%AD%98%E6%A1%A3\',\'_blank\')">🔗 打开 GitHub 令牌页</button></div>' +
        '<input id="acc-gh-token" placeholder="粘贴令牌（ghp_… 或 github_pat_…）" style="width:100%;margin-top:8px">' +
        '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
      footer: '<button class="btn ok" onclick="V4Account.bindGitHubToken()">绑定</button>' +
        '<button class="btn ghost" onclick="V4Account.bindGitHubDevice()">用设备码绑定</button>' +
        '<button class="btn" data-close>取消</button>',
    });
    return;
  }
  msg('正在打开 GitHub 授权页……');
  const r = await a.bindGitHubOAuth();
  afterBind(r, 'github');
}
export async function bindGitHubToken(): Promise<void> {
  const a = A(); if (!a) return;
  const t = val('#acc-gh-token');
  if (!t) { msg('先把令牌粘进来', true); return; }
  msg('正在校验令牌……');
  const r = await a.bindGitHubToken(t);
  afterBind(r, 'github');
}
export async function bindGitHubDevice(): Promise<void> {
  const a = A(); if (!a) return;
  msg('正在申请设备码……');
  const r = await a.bindGitHubDevice(info => {
    msg('请在打开的页面上输入设备码：' + info.user_code);
    try { window.open(info.verification_uri, '_blank'); } catch { /* ignore */ }
  });
  if (!r.ok) { msg(r.err ?? '设备码绑定失败', true); return; }
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
  if (!r.ok) { msg(r.err ?? '绑定失败', true); return; }
  L.log('☁️ 已绑定' + (provider === 'github' ? ' GitHub' : ' 微软') + '账号，存档可以同步到云端了。', 'success');
  L.closeAllModals(); openPanel(); L.render();
}
export function unbind(provider: 'github' | 'microsoft'): void {
  A()?.unbind(provider);
  L.closeAllModals(); openPanel();
}

/* ── 存档上传 / 下载 ── */
export function push(): void { void pushAsync(); }
async function pushAsync(): Promise<void> {
  const a = A(); if (!a) return;
  const u = a.current();
  if (!u) { toastMsg('先登录', '没登录时存档只在本机，登录后才能带账号走。', 'bad'); return; }
  const r = a.savePut(GAME, SLOT, L.S);
  if (!r.ok) { toastMsg('存档失败', r.err ?? '', 'bad'); return; }
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

/** 把账号里的存档放回游戏（走 legacy 的 sanitize，坏档不放进来） */
export function applySave(data: unknown): boolean {
  try {
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

/* ── 导入 / 导出 / 改密 / 删号 ── */
export function exportAll(): void {
  const a = A(); if (!a) return;
  const r = a.exportAll();
  if (!r.ok) { toastMsg('导出失败', r.err ?? '', 'bad'); return; }
  L.modal({
    title: '⬆️ 导出全部存档', sticky: true,
    body: '<p class="muted">把下面的文本抄走就完成了离线备份（换设备时用「导入存档」还原）。</p>' +
      '<textarea id="acc-exp" style="width:100%;height:130px;margin-top:10px;background:#0d0f13;color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:8px;font-family:var(--mono);font-size:11px;">' +
      esc(r.json) + '</textarea>',
    footer: '<button class="btn" data-close>关闭</button>',
  });
}
export function importAll(): void {
  const a = A(); if (!a) return;
  L.modal({
    title: '⬇️ 导入存档', sticky: true,
    body: '<p class="muted">粘贴之前导出的文本，导入会按槽位覆盖本机存档。</p>' +
      '<textarea id="acc-imp" style="width:100%;height:130px;margin-top:10px;background:#0d0f13;color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:8px;font-family:var(--mono);font-size:11px;"></textarea>' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.doImport()">导入</button><button class="btn" data-close>取消</button>',
  });
}
export function doImport(): void {
  const a = A(); if (!a) return;
  const r = a.importAll(val('#acc-imp'));
  if (!r.ok) { msg(r.err ?? '导入失败', true); return; }
  L.closeAllModals(); L.render();
  toastMsg('导入完成', '恢复了 ' + r.count + ' 个存档槽。', 'ok');
}
/* ── 存档文件导入 / 导出（不依赖任何第三方账号：换设备最省事的办法） ── */
export function exportFile(): void {
  const a = A(); if (!a) return;
  const r = a.exportAll();
  if (!r.ok) { toastMsg('导出失败', r.err ?? '', 'bad'); return; }
  try {
    const blob = new Blob([String(r.json)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url;
    el.download = GAME + '-saves-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    L.log('💾 存档文件已下载（' + Math.round(String(r.json).length / 1024) + ' KB）——存网盘或拷 U 盘都行。', 'success');
  } catch (e) {
    toastMsg('下载失败', '浏览器拦了下载，可以改用「导出文本」复制粘贴。', 'bad');
    console.warn('[v4] 导出文件失败', e);
  }
}
export function importFile(): void {
  L.modal({
    title: '📂 从文件导入存档', sticky: true,
    body: '<p class="muted">选之前导出的那个 <span class="mono">' + GAME + '-saves-日期.json</span>，按槽位覆盖本机存档。</p>' +
      '<input type="file" id="acc-file" accept=".json,application/json" style="margin-top:10px;width:100%">' +
      '<div class="hint" id="acc-msg" style="margin-top:8px"></div>',
    footer: '<button class="btn ok" onclick="V4Account.doImportFile()">导入</button><button class="btn" data-close>取消</button>',
  });
}
export function doImportFile(): void {
  const a = A(); if (!a) return;
  const input = L.$('#acc-file') as HTMLInputElement | null;
  const f = input?.files?.[0];
  if (!f) { msg('先选一个文件', true); return; }
  const fr = new FileReader();
  fr.onload = () => {
    const r = a.importAll(String(fr.result ?? ''));
    if (!r.ok) { msg(r.err ?? '导入失败', true); return; }
    L.closeAllModals(); L.render();
    toastMsg('导入完成', '从文件恢复了 ' + r.count + ' 个存档槽。', 'ok');
  };
  fr.onerror = () => msg('读文件失败', true);
  fr.readAsText(f);
}

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

/* ── 自动同步：包一层 legacy 的 autosave ── */
export function wrapAutosave(): void {
  const orig = L.autosave;
  if (typeof orig !== 'function' || (orig as never as { __accWrapped?: boolean }).__accWrapped) return;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const r = (orig as (...a: unknown[]) => unknown).apply(this, args);
    const a = A();
    if (autoSync && a?.current()) {
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = setTimeout(() => {
        try {
          a.savePut(GAME, SLOT, L.S);
          void a.pushAll(GAME).then(res => {
            if (res.ok) L.log('☁️ 自动同步：存档已推到云端。', 'dim');
          });
        } catch (e) { console.warn('[v4] 自动同步失败', e); }
      }, 8000);
    }
    return r;
  };
  (wrapped as never as { __accWrapped?: boolean }).__accWrapped = true;
  L.autosave = wrapped as never;
}
