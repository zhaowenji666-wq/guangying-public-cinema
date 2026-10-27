import { resolve, rewritePlaylist, prefetchSegments, json, secretOf } from '../../_lib/cinema.js';
import { rescuePlaylist } from '../../_lib/rescue.js';

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const secret = secretOf(env);
  const token = (params.token || []).join('/');
  const target = await resolve(secret, token);
  if (!target) return json({ error: '播放链接已过期，请重新搜索' }, 410);
  try {
    const range = request.headers.get('range');
    let r = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...(range ? { Range: range } : {}) },
    });
    let type = String(r.headers.get('content-type') || '');
    // 很多采集源的播放地址是播放页（返回 text/html），真实 m3u8 藏在页面里或需补 /index.m3u8。
    // 直接放弃会白白损失大量可用源，这里尝试自动还原。
    if (/text\/html/i.test(type) && !/mpegurl/i.test(type)) {
      const rescued = await rescuePlaylist(target);
      if (!rescued) throw Error('片源返回页面而非视频，请换一个片源');
      r = await fetch(rescued, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      type = String(r.headers.get('content-type') || '');
    }
    if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(target)) {
      const label = target;
      const text = await r.text();
      if (!text.trimStart().startsWith('#EXTM3U')) throw Error('播放列表格式无效');
      prefetchSegments(r.url || target, waitUntil);
      return new Response(await rewritePlaylist(secret, text, r.url || target), {
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
