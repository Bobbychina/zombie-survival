/**
 * 站点级 BETA 声明条（仿《逃离塔科夫》主界面那条"当前版本 / 不代表最终品质"的提示）。
 *
 * 为什么插在 body 最前面 + sticky：正常流里会占住自己那一行高度，滚动时再吸顶，
 * 所以既不会被游戏 HUD 压住，也不会挡住任何 UI；sticky 元素在流内 → 不需要给 body 补 padding。
 * 幂等：站点脚本（bobbychina-pages/beta-notice.js）注入过就跳过，避免两条。
 */
const BETA_VERSION = 'v4.0.0-beta';
const MOBILE_KEY = 'dsh.mobile-notice.dismissed';

const CSS = `
#beta-notice{position:sticky;top:0;z-index:2147483000;display:flex;gap:10px;align-items:center;
  justify-content:center;flex-wrap:wrap;padding:6px 14px;text-align:center;
  font:12px/1.45 "Cascadia Mono",Consolas,ui-monospace,monospace;letter-spacing:.2px;
  background:#2a2113;color:#e2bd63;border-bottom:1px solid #5a4718}
#beta-notice .tag{background:#e8c15a;color:#2a2113;border-radius:4px;padding:1px 6px;font-size:11px;
  font-weight:700;letter-spacing:1px}
#beta-notice .ver{color:#f4dd97;font-style:normal}
#beta-notice .warn{color:#f0a35e}
#beta-notice .sep{opacity:.45}
@media (max-width:560px){#beta-notice{font-size:11px;padding:5px 10px;gap:6px}}
#mobile-warn{position:relative;z-index:2147482999;display:flex;gap:10px;align-items:center;
  justify-content:center;flex-wrap:wrap;padding:9px 16px;text-align:center;
  font:13px/1.5 system-ui,"Segoe UI",sans-serif;background:#3a2415;color:#ffd7a8;border-bottom:1px solid #6b4423}
#mobile-warn b{color:#ffc27a}
#mobile-warn button{margin-left:6px;background:transparent;border:1px solid #8a5a2b;color:#ffd7a8;
  border-radius:6px;padding:2px 9px;font-size:12px;cursor:pointer}
`;

/** 手机端没做适配：触屏操作、窄屏排版都不行，进来先说清楚，别让人以为游戏就这么烂 */
function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 820;
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MiuiBrowser|MicroMessenger/i.test(ua) || (touch && narrow);
}

function mobileWarnDismissed(): boolean {
  try { return sessionStorage.getItem(MOBILE_KEY) === '1'; } catch { return false; }
}

function installMobileWarn(): void {
  if (!isMobile() || mobileWarnDismissed() || document.getElementById('mobile-warn')) return;
  const bar = document.createElement('div');
  bar.id = 'mobile-warn';
  bar.setAttribute('role', 'alert');
  bar.innerHTML = '<span>📱 <b>手机端暂未做适配</b>：这是键鼠操作的游戏，触屏和窄屏下排版、操作都会很难受，'
    + '建议换电脑打开。</span>';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '知道了';
  btn.onclick = () => {
    try { sessionStorage.setItem(MOBILE_KEY, '1'); } catch { /* 无痕模式忽略 */ }
    bar.parentNode?.removeChild(bar);
  };
  bar.appendChild(btn);
  const anchor = document.getElementById('beta-notice');
  if (anchor?.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
  else document.body.insertBefore(bar, document.body.firstChild);
}

/** 第一方匿名计数：无 Cookie、不存 IP，只报页面/来源/语言/屏宽；失败绝不影响游戏。
    后端没启用时第一次失败就本会话不再试（避免 404 刷控制台）。 */
function countView(): void {
  try {
    if (sessionStorage.getItem('dsh.hit.off') === '1') return;
    const api = String((globalThis as { DSH_AUTH_CONFIG?: { api?: string } }).DSH_AUTH_CONFIG?.api || '');
    if (!api) return;
    const body = JSON.stringify({
      p: location.pathname || '/game',
      r: document.referrer ? document.referrer.split('/')[2] || '' : '',
      w: window.innerWidth || 0,
      l: navigator.language || '',
    });
    const off = () => { try { sessionStorage.setItem('dsh.hit.off', '1'); } catch { /* 无痕忽略 */ } };
    void fetch(api.replace(/\/+$/, '') + '/api/hit', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, mode: 'cors',
    }).then(r => { if (!r.ok) off(); }).catch(off);
  } catch { /* 计数失败无所谓 */ }
}

export function installBetaNotice(version: string = BETA_VERSION): void {
  if (typeof document === 'undefined' || !document.body) return;
  installMobileWarn();                                              // 手机端提醒（与 BETA 条无关，独立判断）
  countView();                                                      // 匿名计数（无 Cookie、无 IP）
  if (document.getElementById('beta-notice')) return;               // 已经有一条了
  const style = document.createElement('style');
  style.id = 'beta-notice-style';
  style.textContent = CSS;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'beta-notice';
  bar.setAttribute('role', 'status');
  bar.innerHTML =
    '<span class="tag">BETA</span>' +
    '<span>当前版本 <i class="ver">' + version + '</i></span>' +
    '<span class="sep">·</span>' +
    '<span>本版本仍在开发中，<b class="warn">不代表最终品质</b></span>';
  document.body.insertBefore(bar, document.body.firstChild);
  /* 兜底：布局若把内容居中（flex/grid），sticky 会被摆到画面中间 → 改成固定吸顶 + body 让出等高空间 */
  requestAnimationFrame(() => {
    if (bar.getBoundingClientRect().top > 4) {
      bar.style.position = 'fixed';
      bar.style.top = '0';
      bar.style.left = '0';
      bar.style.right = '0';
      document.body.style.paddingTop = bar.offsetHeight + 'px';
    }
  });
}
