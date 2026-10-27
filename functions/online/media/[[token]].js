import { resolve, rewritePlaylist, prefetchSegments, isSegment, json, secretOf } from '../../_lib/cinema.js';

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const secret = secretOf(env);
  const token = (params.token || []).join('/');
  const target = await resolve(secret, token);
  if (!target) return json({ error: '播放链接已过期，请重新搜索' }, 410);
  try {
    const range = request.headers.get('range');
    const r = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...(range ? { Range: range } : {}) },
    });
    const type = String(r.headers.get('content-type') || '');
    if (/text\/html/i.test(type) && !/mpegurl/i.test(type)) throw Error('片源返回页面而非视频，请换一个片源');
    if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(target)) {
      const text = await r.text();
      if (!text.trimStart().startsWith('#EXTM3U')) throw Error('播放列表格式无效');
      prefetchSegments(target, waitUntil);
      return new Response(await rewritePlaylist(secret, text, target), {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' },
      });
    }
    const headers = new Headers(r.headers);
    headers.set('Cache-Control', 'public, max-age=21600');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(r.body, { status: r.status, headers });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
