// 直播源体检：逐条验证「HTTPS 可访问 → 允许跨域 → 分片可解码」。
// 只报告、不自动删减 —— 直播源抖动频繁，自动删减容易误杀，由人工确认后再更新 live-sources.json。
//
//   node scripts/audit-live.mjs           体检全部频道
//   node scripts/audit-live.mjs --only=卫视
//
// 判定标准：
//   playlist  清单可取且含 #EXTM3U
//   ts        TS 分片以 0x47 同步字节开头
//   fmp4      分片含 ftyp/styp
//   drm       ARCVIDEO / SAMPLE-AES 等私有加密，浏览器无法播放
//   fail      网络失败或分片返回错误页
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(base, 'live-sources.json'), 'utf8'));
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const channels = (raw.channels || []).filter(c => !only || c.group === only);
const UA = { 'User-Agent': 'Mozilla/5.0' };

const withTimeout = async (fn, ms = 12000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fn(c.signal); } finally { clearTimeout(t); }
};

async function getText(url) {
  try {
    return await withTimeout(async signal => {
      const r = await fetch(url, { headers: UA, signal });
      return { ok: r.ok, status: r.status, body: await r.text() };
    });
  } catch { return { ok: false, status: 0, body: '' }; }
}

async function getHead(url, range) {
  try {
    return await withTimeout(async signal => {
      const headers = range ? { ...UA, Range: 'bytes=0-2047' } : { ...UA };
      const r = await fetch(url, { headers, signal });
      return { status: r.status, buf: new Uint8Array(await r.arrayBuffer()), cors: r.headers.get('access-control-allow-origin') };
    });
  } catch { return { status: 0, buf: new Uint8Array(), cors: null }; }
}

const firstUrl = body => body.split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#')) || '';

// 层层展开 master playlist，直到拿到实际分片地址
async function resolve(url, depth = 0) {
  const r = await getText(url);
  if (!r.ok || !/#EXTM3U/.test(r.body)) return { error: '清单 ' + r.status };
  if (/#EXT-X-STREAM-INF/.test(r.body) && depth < 2) {
    const lines = r.body.split('\n').map(s => s.trim());
    let best = null, bw = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/BANDWIDTH=(\d+)/);
      if (m && lines[i + 1] && !lines[i + 1].startsWith('#')) {
        const v = +m[1];
        if (v > bw) { bw = v; best = lines[i + 1]; }
      }
    }
    if (best) return resolve(new URL(best, url).href, depth + 1);
  }
  const key = r.body.match(/#EXT-X-KEY:METHOD=([^,\n]+)(?:[^\n]*URI="([^"]+)")?/);
  return { seg: new URL(firstUrl(r.body), url).href, key: key ? { method: key[1], uri: key[2] } : null };
}

function classify(buf) {
  if (!buf.length) return 'empty';
  if (buf[0] === 0x47) return 'ts';
  const ascii = String.fromCharCode(...buf.slice(0, 32));
  if (ascii.includes('ftyp') || ascii.includes('styp')) return 'fmp4';
  if (ascii.startsWith('#EXTM3U')) return 'playlist';
  if (/ARCVIDEO|PROTECTED/i.test(ascii)) return 'drm';
  return 'other:' + ascii.replace(/[^\x20-\x7e]/g, '.').slice(0, 18);
}

async function check(ch) {
  const started = Date.now();
  const rec = { name: ch.name, group: ch.group, verdict: 'fail', detail: '', ms: 0 };
  const res = await resolve(ch.url);
  if (res.error) { rec.detail = res.error; rec.ms = Date.now() - started; return rec; }

  if (res.key && /SAMPLE-AES/i.test(res.key.method)) {
    rec.detail = '私有加密 ' + res.key.method; rec.ms = Date.now() - started; return rec;
  }
  let head = await getHead(res.seg, true);
  let kind = classify(head.buf);
  if (kind.startsWith('other:<') || kind === 'empty') {
    head = await getHead(res.seg, false);
    kind = classify(head.buf);
  }
  const good = kind === 'ts' || kind === 'fmp4' || kind === 'playlist';
  rec.verdict = good ? 'ok' : (kind === 'drm' ? 'drm' : 'fail');
  rec.detail = kind + (head.cors ? '' : ' 无CORS');
  rec.ms = Date.now() - started;
  return rec;
}

const out = [];
for (let i = 0; i < channels.length; i += 8) {
  out.push(...await Promise.all(channels.slice(i, i + 8).map(check)));
}

const ok = out.filter(r => r.verdict === 'ok');
const drm = out.filter(r => r.verdict === 'drm');
const fail = out.filter(r => r.verdict === 'fail');
console.log(`可用 ${ok.length}/${out.length}${drm.length ? ' 私有加密 ' + drm.length : ''}`);
for (const r of [...drm, ...fail]) console.log(`  ✗ ${r.name.padEnd(16)} ${r.detail}`);

fs.writeFileSync(
  path.join(base, 'live-report.json'),
  JSON.stringify({ at: Date.now(), total: out.length, ok: ok.length, channels: out }, null, 1)
);
console.log('已写入 live-report.json（仅供人工确认，不会改动 live-sources.json）');
