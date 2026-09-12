/* 内存版 KV：把 Cloudflare Workers KV 的那几个方法按同样的语义实现一遍，
   这样 cf-worker.js 可以原样跑在 Node 上（测试与本地联调都不用连 Cloudflare）。
   语义要点：get(key, 'json'|'text') 不存在时返回 null / undefined，list 支持 prefix + cursor。 */
export function memoryKV() {
  const m = new Map();   // key -> { value, expiresAt }
  const alive = k => {
    const e = m.get(k);
    if (!e) return null;
    if (e.expiresAt && e.expiresAt < Date.now()) { m.delete(k); return null; }
    return e;
  };
  return {
    async get(key, type) {
      const e = alive(key);
      if (!e) return type === 'json' ? null : null;
      const v = e.value;
      if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    async put(key, value, opts) {
      const ttl = opts && opts.expirationTtl;
      m.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl * 1000 : 0 });
    },
    async delete(key) { m.delete(key); },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      const limit = opts.limit || 1000;
      const keys = [...m.keys()].filter(k => k.startsWith(prefix) && alive(k)).sort();
      const start = opts.cursor ? Number(Buffer.from(opts.cursor, 'base64').toString('utf8')) : 0;
      const page = keys.slice(start, start + limit);
      const next = start + limit;
      return {
        keys: page.map(name => ({ name })),
        list_complete: next >= keys.length,
        cursor: next >= keys.length ? undefined : Buffer.from(String(next), 'utf8').toString('base64'),
      };
    },
    _size: () => m.size,
    _dump: () => Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.value])),
  };
}
