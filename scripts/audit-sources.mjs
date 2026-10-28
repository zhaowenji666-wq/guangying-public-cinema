// 片源体检：通过已部署站点探测每个源，把「能搜到且能播」的源标记为可用。
// 必须用线上地址探测而不是本机 —— Cloudflare 的网络与本机不同
// （例如 B 站、play.xluuss.com 就是本机通、CF 不通），只有线上探测才代表用户真实体验。
//
//   node scripts/audit-sources.mjs [站点地址]
// 结果写入 functions/_health.js，供 /api/source-health 返回真实状态。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.argv[2] || 'https://guangying-cinema-c1l.pages.dev';
const QUERY = process.env.AUDIT_QUERY || '庆余年';
const TIMEOUT = 25000;
const BUDGET = 60000;

const main = JSON.parse(fs.readFileSync(path.join(base, 'sources.json'), 'utf8')).api_site;
let custom = {};
try { custom = JSON.parse(fs.readFileSync(path.join(base, 'sources.custom.json'), 'utf8')).api_site || {}; } catch {}
const all = { ...main, ...custom };

const withTimeout = async (promise, ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await promise(c.signal); } finally { clearTimeout(t); }
};

// ---- 分片真实性校验 ----
// 曾经踩过的坑：某些源（如 iqiyizyapi.com）的播放列表看着完全正常，
// 但"分片"其实是一张张 JPEG，每张停 4 秒 —— 是个幻灯片，不是视频。
// 只验"播放列表 200"会把它判成可用，用户点开却什么都没有，所以必须看分片魔数。

async function text(url, signal) {
  const r = await fetch(url, { signal });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

// 主清单要逐层下探到真正的分片清单
async function mediaPlaylist(url, signal) {
  let pl = await text(url, signal);
  if (!pl.text.trimStart().startsWith('#EXTM3U')) return null;
  for (let depth = 0; depth < 3 && /#EXT-X-STREAM-INF/.test(pl.text); depth++) {
    const variant = pl.text.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'))?.trim();
    if (!variant) return pl;
    const next = await text(new URL(variant, SITE).href, signal);
    if (!next.text.trimStart().startsWith('#EXTM3U')) return null;
    pl = next;
  }
  return pl;
}

function magicOf(buf) {
  if (!buf || buf.length < 8) return 'too-short';
  const ascii = (from, to) => String.fromCharCode(...buf.subarray(from, to));
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(4, 8) === 'ftyp' || ascii(4, 8) === 'styp') return 'fmp4';
  if (buf[0] === 0x47 && (buf.length <= 188 || buf[188] === 0x47)) return 'ts';
  const head = ascii(0, Math.min(64, buf.length)).toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype')) return 'html';
  return 'unknown';
}

// AES-128 的 IV：清单里有 IV= 就用它，否则用分片序号补成 128 位大端
function ivFor(keyLine, seq) {
  const explicit = keyLine.match(/IV=0x([0-9a-fA-F]{32})/);
  if (explicit) return Buffer.from(explicit[1], 'hex');
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(seq >>> 0, 12);
  return iv;
}

async function probeSegment(pl, signal) {
  const lines = pl.text.split(/\r?\n/);
  const keyLine = lines.find(l => /^#EXT-X-KEY:/.test(l) && !/METHOD=NONE/.test(l));
  const segLine = lines.find(l => l.trim() && !l.startsWith('#'));
  if (!segLine) return { ok: false, reason: '播放列表没有分片' };

  const r = await fetch(new URL(segLine.trim(), SITE).href, { signal, headers: { Range: 'bytes=0-8191' } });
  if (!r.ok) return { ok: false, reason: `分片返回 ${r.status}` };
  let buf = Buffer.from(await r.arrayBuffer());

  if (keyLine) {
    const uri = keyLine.match(/URI="([^"]+)"/)?.[1];
    if (!uri) return { ok: false, reason: '密钥地址缺失' };
    const keyRes = await fetch(new URL(uri, SITE).href, { signal });
    const key = Buffer.from(await keyRes.arrayBuffer());
    if (key.length !== 16) return { ok: false, reason: `AES 密钥长度异常 ${key.length}B` };
    if (buf.length < 16) return { ok: false, reason: '分片过短' };
    const seq = Number(pl.text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1] || 0);
    try {
      const d = crypto.createDecipheriv('aes-128-cbc', key, ivFor(keyLine, seq));
      d.setAutoPadding(false);
      // 首块解密与后续块无关，只解 16 字节即可判断魔数
      buf = Buffer.concat([d.update(buf.subarray(0, 16)), d.final()]);
    } catch (e) {
      return { ok: false, reason: '分片解密失败' };
    }
  }

  const kind = magicOf(buf);
  // 图片、网页都不是视频：这类源"能播"是假象，直接判不可用
  if (kind === 'jpeg' || kind === 'png' || kind === 'gif' || kind === 'html') {
    return { ok: false, reason: `分片是 ${kind}，不是视频` };
  }
  if (kind === 'ts' || kind === 'fmp4') return { ok: true, kind, encrypted: !!keyLine };
  return { ok: false, reason: `分片格式无法识别（${kind}）` };
}

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

    const media = await withTimeout(async signal => {
      const pl = await mediaPlaylist(SITE + ep.url, signal);
      if (!pl) return { ok: false, reason: '播放列表格式异常' };
      return probeSegment(pl, signal);
    }, BUDGET);

    if (!media.ok) { rec.reason = media.reason; rec.ms = Date.now() - started; return rec; }
    rec.enabled = true;
    rec.kind = media.kind;
    rec.encrypted = media.encrypted;
    rec.ms = Date.now() - started;
  } catch (e) {
    rec.reason = e.name === 'AbortError' ? '超时' : String(e.message).slice(0, 40);
    rec.ms = Date.now() - started;
  }
  return rec;
}

const ids = Object.keys(all);
const results = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 串行、单次、源之间留停顿。
// 这些采集站对同一 IP 的连续请求很敏感：并发或快速重试会把「本来能播」的源打成 502/连接重置，
// 审计自己制造假失败（实测连续高强度探测后，连本机 IP 都被 dyttzyapi.com 重置）。
// 真实用户是一次搜一次播，审计也应按这个节奏来。
for (const id of ids) {
  const r = await check(id, all[id]);
  results[id] = r;
  const tag = r.enabled ? (r.kind + (r.encrypted ? '+AES' : '')).padEnd(9) : '';
  console.log(`${r.enabled ? '✓' : '✗'} ${sourceName(r.name).padEnd(18)} ${String(r.ms).padStart(6)}ms ${tag} ${r.reason}`);
  await sleep(400);
}

function sourceName(s) { return String(s || '').slice(0, 18); }

const ok = Object.values(results).filter(r => r.enabled).length;
console.log(`\n可用 ${ok}/${ids.length}`);

fs.writeFileSync(
  path.join(base, 'functions', '_health.js'),
  '// 由 scripts/audit-sources.mjs 生成（探测站点：' + SITE + '），请勿手改\n' +
  'export const health = ' + JSON.stringify({ at: Date.now(), site: SITE, query: QUERY, sources: results }) + ';\n'
);
console.log('已写入 functions/_health.js');
