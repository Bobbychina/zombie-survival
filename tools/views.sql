-- bobbychina 站点访问统计 · Analytics Engine 查询集
-- 面板位置：dash.cloudflare.com → Workers & Pages → Analytics Engine → 数据集 site_hits → SQL
--
-- 注意：AE 的 SQL 解析器**只认 ASCII 标识符**，别名别用中文（会报
--       `sql parser error: Expected an identifier after AS, found: 日\`）。
--       非要中文就加双引号 AS "日期"，但没必要。
--
-- 字段映射（写入见 tools/cf-worker.js 的 /api/hit）：
--   blob1 / index1 = 页面路径    blob2 = 来源域名    blob3 = 浏览器语言
--   double1 = 固定 1（可 sum）   double2 = 窗口宽度（<=820 当成手机）

-- 1) 最近 24 小时：总浏览量 + 覆盖了多少个页面
SELECT count() AS views, uniq(blob1) AS pages
FROM site_hits
WHERE timestamp > NOW() - INTERVAL '1' DAY;

-- 2) 7 天：哪些页面看得最多
SELECT blob1 AS page, count() AS views, uniq(blob2) AS ref_domains
FROM site_hits
WHERE timestamp > NOW() - INTERVAL '7' DAY AND blob1 != '/__probe'
GROUP BY page
ORDER BY views DESC;

-- 3) 7 天：从哪来的
SELECT blob2 AS ref, count() AS hits
FROM site_hits
WHERE timestamp > NOW() - INTERVAL '7' DAY AND blob2 != ''
GROUP BY ref
ORDER BY hits DESC
LIMIT 20;

-- 4) 手机 vs 电脑（按窗口宽度粗分）
SELECT if(double2 <= 820, 'mobile', 'desktop') AS kind, count() AS views
FROM site_hits
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY kind;

-- 5) 每天的量（看趋势）
SELECT toDate(timestamp) AS day, count() AS views
FROM site_hits
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day
ORDER BY day;

-- 6) 想看真实浏览器语言分布
SELECT blob3 AS lang, count() AS views
FROM site_hits
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY lang
ORDER BY views DESC;

-- 7) 数据量大之后 AE 会自动采样，count() 会偏小 → 换成 sum(_sample_interval)
--    （现在量小，用上面的 count() 就是准的；数字明显不对时再换）
SELECT blob1 AS page, sum(_sample_interval) AS views
FROM site_hits
GROUP BY page
ORDER BY views DESC;
