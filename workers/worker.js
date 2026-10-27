// 光影公开版 · Cloudflare Workers 版
// 与 Node 版功能一致，但改用 Workers 运行时：
// - 去掉 node:http / node:https / node:dns，改用全局 fetch（请求由 Cloudflare 边缘发起）
// - 视频分段使用 Cloudflare Cache API 缓存，跨 isolate 持久，命中即边缘直出、不回源
// - 播放链接令牌改为无状态 HMAC 签名，isolate 重启后依然有效

import sourceConfig from '../sources.json';

const sources = Object.entries(sourceConfig.api_site).map(([id, s]) => ({ id, name: s.name, api: s.api }));

const PREFETCH = 12;
const SEG_RE = /\.(ts|m4s|mp4|mp2t)(?:[?#]|$)/i;
const enc = new TextEncoder();

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg))))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function register(secret, url) {
  if (!/^https?:\/\//i.test(url)) return '';
  const payload = b64url(JSON.stringify({ u: url, e: Date.now() + 6 * 3600 * 1000 }));
  return '/online/media/' + payload + '.' + (await hmac(secret, payload)).slice(0, 24);
}
async function resolve(secret, token) {
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

async function query(secret, source, params) {
  const u = new URL(source.api);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0' }, cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw Error('片源返回 ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data.list)) throw Error('片源未返回影片列表');
  const norm = s => plain(s).toLowerCase().replace(/\s/g, '');
  const list = data.list.filter(m => m.vod_id && m.vod_name &&
    !/成人版|伦理片|色情|情色|AV女优/.test(m.vod_name + ' ' + (m.type_name || '')) &&
    (!params.wd || norm([m.vod_name, m.vod_actor, m.vod_director].filter(Boolean).join(' ')).includes(norm(params.wd))));
  return await Promise.all(list.slice(0, 60).map(m => makeResult(secret, m, source)));
}

async function rewritePlaylist(secret, text, baseUrl) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) { out.push(line); continue; }
    if (line.startsWith('#')) { out.push(line); continue; }
    out.push(await register(secret, new URL(line.trim(), baseUrl).href));
  }
  return out.join('\n');
}

async function cachedFetch(url, ctx) {
  const req = new Request(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const cache = caches.default;
  try { const hit = await cache.match(req); if (hit) { const h = new Headers(hit.headers); h.set('X-Cache', 'HIT'); return new Response(hit.body, { status: hit.status, headers: h }); } } catch {}
  const resp = await fetch(req, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const headers = new Headers(resp.headers);
  headers.set('Cache-Control', 'public, max-age=21600');
  let stored = 'PUT-FAILED';
  if (resp.ok) {
    const clone = resp.clone();
    try {
      await cache.put(req, new Response(clone.body, { headers: new Headers(headers) }));
      stored = 'MISS-STORED';
    } catch (e) { stored = 'MISS-PUTERR:' + (e && e.message ? e.message.slice(0, 40) : 'unknown'); }
  } else { stored = 'MISS-UPSTREAM-' + resp.status; }
  headers.set('X-Cache', stored);
  return new Response(resp.body, { status: resp.status, headers });
}

// 响应播放列表时后台并发预取开头几段：源站单连接限速，靠并发把叠加带宽吃满。
function prefetchSegments(playlistUrl, ctx) {
  ctx.waitUntil((async () => {
    try {
      let cur = playlistUrl;
      for (let depth = 0; depth < 3; depth++) {
        const r = await fetch(cur, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!r.ok) return;
        const text = await r.text();
        const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const variant = lines.find(x => !x.startsWith('#') && !SEG_RE.test(x));
        if (variant) { cur = new URL(variant, cur).href; continue; }
        const segs = lines.filter(x => !x.startsWith('#') && SEG_RE.test(x))
          .slice(0, PREFETCH).map(s => new URL(s, cur).href);
        await Promise.allSettled(segs.map(u => cachedFetch(u, ctx)));
        return;
      }
    } catch {}
  })());
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env, ctx) {
    const secret = env.MEDIA_SECRET || 'guangying-cinema';
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/extension') return json({ ok: true, version: 3, runtime: 'workers' });
      if (url.pathname === '/api/online/sources')
        return json({ sources: sources.map(({ id, name }) => ({ id, name })), project: 'LunaTV-config + DecoTV' });
      // 前端只启用 enabled===true 的片源，缺少这个接口会被过滤成空列表，导致搜不到任何影片。
      // 边缘侧不做定时探测，全部标记为可用，由搜索/播放时的自动换线兜底。
      if (url.pathname === '/api/source-health')
        return json({ at: Date.now(), auditing: false, disabled: 0, sources: Object.fromEntries(sources.map(s => [s.id, { name: s.name, enabled: true }])) });
      if (url.pathname === '/api/source-health/recheck')
        return json({ error: '在线版暂不支持公开触发检测' }, 405);

      if (['/api/online/search', '/api/online/detail'].includes(url.pathname)) {
        const source = sources.find(s => s.id === url.searchParams.get('source'));
        if (!source) return json({ error: '片源不存在' }, 400);
        const detail = url.pathname.endsWith('/detail');
        const q = (url.searchParams.get(detail ? 'id' : 'q') || '').trim().slice(0, 120);
        if (!q) return json({ error: '请输入片名' }, 400);
        try {
          let results = await query(secret, source, detail ? { ac: 'detail', ids: q } : { ac: 'videolist', wd: q });
          if (detail && !results.some(m => m.episodes.length)) results = await query(secret, source, { ac: 'videolist', ids: q });
          return json({ results });
        } catch (e) { return json({ error: e.message, results: [] }, 502); }
      }

      if (url.pathname.startsWith('/online/media/')) {
        const target = await resolve(secret, url.pathname.split('/').pop());
        if (!target) return json({ error: '播放链接已过期，请重新搜索' }, 410);
        if (SEG_RE.test(target)) {
          const r = await cachedFetch(target, ctx);
          const headers = new Headers(r.headers);
          headers.set('Cache-Control', 'public, max-age=21600');
          headers.set('X-Content-Type-Options', 'nosniff');
          return new Response(r.body, { status: r.status, headers });
        }
        const range = request.headers.get('range');
        const r = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0', ...(range ? { Range: range } : {}) },
        });
        const type = String(r.headers.get('content-type') || '');
        // 部分失效片源会返回 HTML 页面而不是视频，直接转发会让播放器拿到一堆网页代码。
        if (/text\/html/i.test(type) && !/mpegurl/i.test(type)) throw Error('片源返回页面而非视频，请换一个片源');
        if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(target)) {
          const text = await r.text();
          if (!text.trimStart().startsWith('#EXTM3U')) throw Error('播放列表格式无效');
          prefetchSegments(target, ctx);
          return new Response(await rewritePlaylist(secret, text, target), {
            headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
          });
        }
        const headers = new Headers(r.headers);
        headers.set('Cache-Control', 'public, max-age=21600');
        return new Response(r.body, { status: r.status, headers });
      }
    } catch (e) {
      return json({ error: e.message }, 502);
    }
    // 其余请求交给静态资源：把 / 与 /online 映射到 online.html（与 Node 版一致）
    if (env.ASSETS) {
      const path = (url.pathname === '/' || url.pathname === '/online') ? '/online.html' : url.pathname;
      return env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
    }
    return new Response('Not Found', { status: 404 });
  },
};
