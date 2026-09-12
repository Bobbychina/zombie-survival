/* GitHub OAuth 中继（Cloudflare Worker）
   ----------------------------------------------------------------------------
   为什么需要它：GitHub 的换 token 接口 `login/oauth/access_token` 不给浏览器跨域头，
   所以纯静态站（GitHub Pages）拿不到响应，"一键授权"就差这最后一跳。
   这个 Worker 只做一件事：把那两个固定端点的请求原样转发给 GitHub，再把响应带回 CORS 头。

   · 只允许两个路径，其它一律 404（不会被当成通用代理）
   · 不记录、不缓存、不落盘任何内容（GitHub 的 code 是单次有效的，令牌直接还给浏览器）
   · 不需要 client secret：客户端走的是 PKCE 流程，Worker 只是个"跨域桥"

   部署（免费，不需要信用卡）：
     1) npx wrangler login                      # 浏览器里点一下授权（Cloudflare 账号可用邮箱注册）
     2) npx wrangler deploy tools/oauth-relay-worker.js --name dsh-oauth-relay
     3) 把输出的 https://dsh-oauth-relay.<你的子域>.workers.dev 填进
        games/auth-config.js 的 github.relay，刷新页面即可

   如果你有自定义域名，建议绑一个（workers.dev 在部分地区会被拦）。
*/
const ALLOW = {
  '/oauth/access_token': 'https://github.com/login/oauth/access_token',
  '/login/device/code': 'https://github.com/login/device/code',
};

/* 可选加固：只接受来自自己站点的跨域调用（浏览器跨域 POST/预检一定会带 Origin）。
   Origin 缺失的请求（curl 自测）照样放行——这不是安全边界，只是防止别的网站顺手蹭你的中继。 */
const ALLOW_ORIGIN = 'https://bobbychina.github.io';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (origin && ALLOW_ORIGIN && origin !== ALLOW_ORIGIN) return json({ error: 'origin_not_allowed', origin }, 403);
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const target = ALLOW[url.pathname];
    if (!target) return json({ error: 'path_not_allowed', path: url.pathname, allowed: Object.keys(ALLOW) }, 404);
    try {
      const body = await req.text();
      const r = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    } catch (e) {
      return json({ error: 'upstream_failed', message: String(e && e.message || e) }, 502);
    }
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}
