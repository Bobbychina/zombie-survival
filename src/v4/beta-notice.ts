/**
 * 站点级 BETA 声明条（仿《逃离塔科夫》主界面那条"当前版本 / 不代表最终品质"的提示）。
 *
 * 为什么插在 body 最前面 + sticky：正常流里会占住自己那一行高度，滚动时再吸顶，
 * 所以既不会被游戏 HUD 压住，也不会挡住任何 UI；sticky 元素在流内 → 不需要给 body 补 padding。
 * 幂等：站点脚本（bobbychina-pages/beta-notice.js）注入过就跳过，避免两条。
 */
const BETA_VERSION = 'v4.0.0-beta';

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
`;

export function installBetaNotice(version: string = BETA_VERSION): void {
  if (typeof document === 'undefined' || !document.body) return;
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
