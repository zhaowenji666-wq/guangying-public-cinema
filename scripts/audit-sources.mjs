// 片源体检：通过已部署站点探测每个源，把「能搜到且能播」的源标记为可用。
// 必须用线上地址探测而不是本机 —— Cloudflare 的网络与本机不同
// （例如 B 站、play.xluuss.com 就是本机通、CF 不通），只有线上探测才代表用户真实体验。
//
//   node scripts/audit-sources.mjs [站点地址]
// 结果写入 functions/_health.js，供 /api/source-health 返回真实状态。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'https://guangying-cinema-c1l.pages.dev';
const QUERY = process.env.AUDIT_QUERY || '庆余年';
const TIMEOUT = 25000;

const main = JSON.parse(fs.readFileSync(path.join(base, 'sources.json'), 'utf8')).api_site;
let custom = {};
try { custom = JSON.parse(fs.readFileSync(path.join(base, 'sources.custom.json'), 'utf8')).api_site || {}; } catch {}
const all = { ...main, ...custom };

const withTimeout = async (promise, ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await promise(c.signal); } finally { clearTimeout(t); }
};

async function check(id, source) {
  const rec = { name: source.name, enabled: false, ms: 0, reason: '' };
  const started = Date.now();
  try {
    const j = await withTimeout(signal =>
      fetch(`${SITE}/api/online/search?source=${encodeURIComponent(id)}&q=${encodeURIComponent(QUERY)}`, { signal })
        .then(r => r.json()), TIMEOUT);
    if (!j.results?.length) { rec.reason = '搜索无结果'; rec.ms = Date.now() - started; return rec; }

    const m = j.results[0];
    const d = await withTimeout(signal =>
      fetch(`${SITE}/api/online/detail?source=${encodeURIComponent(m.source)}&id=${encodeURIComponent(m.id)}`, { signal })
        .then(r => r.json()), TIMEOUT);
    const ep = d.results?.[0]?.episodes?.[0];
    if (!ep) { rec.reason = '没有可播放剧集'; rec.ms = Date.now() - started; return rec; }

    const r = await withTimeout(signal => fetch(SITE + ep.url, { signal }), TIMEOUT);
    const text = await r.text();
    if (!text.trimStart().startsWith('#EXTM3U')) {
      rec.reason = r.ok ? '播放列表格式异常' : `播放返回 ${r.status}`;
      rec.ms = Date.now() - started;
      return rec;
    }
    rec.enabled = true;
    rec.ms = Date.now() - started;
  } catch (e) {
    rec.reason = e.name === 'AbortError' ? '超时' : String(e.message).slice(0, 40);
    rec.ms = Date.now() - started;
  }
  return rec;
}

const ids = Object.keys(all);
const results = {};
// 并发 4，避免一次打太多请求把站点压垮
let cursor = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (cursor < ids.length) {
    const id = ids[cursor++];
    // 上游抖动明显，失败的源再测一次，避免把可用源误判为坏源
    let r = await check(id, all[id]);
    if (!r.enabled) {
      const again = await check(id, all[id]);
      if (again.enabled) r = again;
    }
    results[id] = r;
    console.log(`${r.enabled ? '✓' : '✗'} ${sourceName(r.name).padEnd(18)} ${String(r.ms).padStart(6)}ms  ${r.reason}`);
  }
}));

function sourceName(s) { return String(s || '').slice(0, 18); }

const ok = Object.values(results).filter(r => r.enabled).length;
console.log(`\n可用 ${ok}/${ids.length}`);

fs.writeFileSync(
  path.join(base, 'functions', '_health.js'),
  '// 由 scripts/audit-sources.mjs 生成（探测站点：' + SITE + '），请勿手改\n' +
  'export const health = ' + JSON.stringify({ at: Date.now(), site: SITE, query: QUERY, sources: results }) + ';\n'
);
console.log('已写入 functions/_health.js');
