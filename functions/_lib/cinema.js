// 与 workers/worker.js 共用的核心逻辑，供 Cloudflare Pages Functions 调用。
// 选择 Pages 而不是 Workers 的原因：*.workers.dev 在国内 DNS 被污染（解析到 Facebook 段），
// 而 *.pages.dev 解析正常，国内可直接访问。
import { sources } from '../_sources.js';

export { sources };

const SEG_RE = /\.(ts|m4s|mp4|mp2t)(?:[?#]|$)/i;
const enc = new TextEncoder();

// 采集站与流媒体 CDN 普遍做 UA 校验：裸露的 "Mozilla/5.0" 在部分节点会被直接断连
// （实测 hd.kuktxu.com 对 "Mozilla/5.0" 间歇性 ECONNRESET，对完整 Chrome UA 稳定 200）。
// 统一用完整桌面 Chrome UA —— 只赚不亏，没有任何源需要"更简陋"的 UA。
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 首次请求只带 UA；防盗链源（返回 401/403）由调用方追加 Referer 再重试，
// 因为错误的 Referer 反而会被某些 CDN 拒绝，不能无条件带上。
export const mediaHeaders = (extra = {}) => ({ 'User-Agent': UA, Accept: '*/*', ...extra });

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export async function register(secret, url) {
  if (!/^https?:\/\//i.test(url)) return '';
  const payload = b64url(JSON.stringify({ u: url, e: Date.now() + 6 * 3600 * 1000 }));
  return '/online/media/' + payload + '.' + (await hmac(secret, payload)).slice(0, 24);
}
export async function resolve(secret, token) {
  const dot = String(token).lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot), sig = token.slice(dot + 1);
  if ((await hmac(secret, payload)).slice(0, 24) !== sig) return null;
  try {
    const data = JSON.parse(unb64url(payload));
    if (!data.e || data.e < Date.now()) return null;
    return /^https?:\/\//i.test(data.u) ? data.u : null;
  } catch { return null; }
}

const plain = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function parseEpisodes(value) {
  let episodes = [];
  for (const group of String(value || '').split('$$$')) {
    const entries = group.split('#').flatMap(entry => {
      const split = entry.indexOf('$');
      if (split < 0) return [];
      const title = plain(entry.slice(0, split)), url = entry.slice(split + 1).trim();
      return /^https?:\/\//i.test(url) ? [{ title: title || '正片', url }] : [];
    });
    if (entries.length > episodes.length) episodes = entries;
  }
  return episodes;
}

async function makeResult(secret, item, source) {
  return {
    id: String(item.vod_id),
    title: plain(item.vod_name),
    actors: plain(item.vod_actor),
    director: plain(item.vod_director),
    genre: plain(item.vod_class || item.type_name),
    type: plain(item.type_name),
    year: plain(item.vod_year).match(/\d{4}/)?.[0] || '',
    poster: await register(secret, item.vod_pic),
    remarks: plain(item.vod_remarks),
    description: plain(item.vod_content).slice(0, 3000),
    source: source.id,
    sourceName: source.name,
    episodes: await Promise.all(parseEpisodes(item.vod_play_url).map(async e => ({
      title: e.title,
      url: await register(secret, e.url),
      hls: !/\.(mp4|webm|mkv)(?:[?#]|$)/i.test(e.url),
    }))),
  };
}

export async function query(secret, source, params) {
  const u = new URL(source.api);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.href, { headers: mediaHeaders(), cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw Error('片源返回 ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data.list)) throw Error('片源未返回影片列表');
  const norm = s => plain(s).toLowerCase().replace(/\s/g, '');
  const unsafe = /成人|伦理|情色|色情|无码|有码|成人视频|AV女优|福利姬|写真|里番|三级(?:片|电影)|限制级/i;
  const list = data.list.filter(m => m.vod_id && m.vod_name &&
    !unsafe.test([m.vod_name, m.type_name, m.vod_class].filter(Boolean).join(' ')) &&
    (!params.wd || norm([m.vod_name, m.vod_actor, m.vod_director].filter(Boolean).join(' ')).includes(norm(params.wd))));
  return await Promise.all(list.slice(0, 60).map(m => makeResult(secret, m, source)));
}

export async function rewritePlaylist(secret, text, baseUrl) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) { out.push(line); continue; }
    if (line.startsWith('#')) {
      // #EXT-X-KEY / #EXT-X-SESSION-KEY / #EXT-X-MAP / #EXT-X-MEDIA / #EXT-X-I-FRAME-STREAM-INF
      // 这些标签的 URI="..." 指向子资源：AES-128 密钥、fMP4 初始化段、音轨/字幕清单。
      // 不重写的话浏览器会按播放列表地址把它们解析成 <本站>/online/media/enc.key，加密源直接黑屏。
      if (!/URI="/.test(line)) { out.push(line); continue; }
      const parts = [];
      const re = /URI="([^"]*)"/g;
      let last = 0, m;
      while ((m = re.exec(line))) {
        parts.push(line.slice(last, m.index));
        const raw = m[1];
        // data: URI 内联密钥没有服务端资源可代，原样保留
        parts.push(/^data:/i.test(raw) ? m[0] : 'URI="' + (await register(secret, new URL(raw, baseUrl).href)) + '"');
        last = m.index + m[0].length;
      }
      parts.push(line.slice(last));
      out.push(parts.join(''));
      continue;
    }
    out.push(await register(secret, new URL(line.trim(), baseUrl).href));
  }
  return out.join('\n');
}

export const isSegment = url => SEG_RE.test(url);
export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
export const secretOf = env => env.MEDIA_SECRET || 'guangying-cinema';
