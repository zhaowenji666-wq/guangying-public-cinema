import { resolve, rewritePlaylist, prefetchSegments, json, secretOf, UA, mediaHeaders } from '../../_lib/cinema.js';
import { rescuePlaylist } from '../../_lib/rescue.js';

// 这些状态码多半是防盗链/UA 校验，值得换一套头再试一次。
const RETRY_STATUS = new Set([401, 403, 404, 451]);

// 拉流：先按常规头请求，被拒则补上同源 Referer/Origin 重试。
// 参考实现（Netscape/DecoTV 一类）都带 Referer，很多 CDN 不带就直接 403。
async function pull(target, range) {
  const extra = range ? { Range: range } : {};
  let r = await fetch(target, { headers: mediaHeaders(extra) });
  if (!RETRY_STATUS.has(r.status)) return r;
  try {
    const origin = new URL(target).origin;
    const retry = await fetch(target, {
      headers: mediaHeaders({ ...extra, Referer: origin + '/', Origin: origin }),
    });
    // 只有重试确实变好了才替换结果，避免把 200 换成更差的状态。
    if (retry.ok || !r.ok) r = retry;
  } catch {
    // 重试本身出错就沿用第一次的结果
  }
  return r;
}

export async function onRequest(context) {
  const { request, env, params, waitUntil } = context;
  const secret = secretOf(env);
  const token = (params.token || []).join('/');
  const target = await resolve(secret, token);
  if (!target) return json({ error: '播放链接已过期，请重新搜索' }, 410);
  try {
    const range = request.headers.get('range');
    let r = await pull(target, range);
    let type = String(r.headers.get('content-type') || '');
    // 很多采集源的播放地址是播放页（返回 text/html），真实 m3u8 藏在页面里或需补 /index.m3u8。
    // 直接放弃会白白损失大量可用源，这里尝试自动还原。
    if (/text\/html/i.test(type) && !/mpegurl/i.test(type)) {
      const rescued = await rescuePlaylist(target);
      if (!rescued) throw Error('片源返回页面而非视频，请换一个片源');
      r = await pull(rescued, '');
      type = String(r.headers.get('content-type') || '');
    }
    if (/mpegurl/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(target)) {
      const text = await r.text();
      if (!text.trimStart().startsWith('#EXTM3U')) throw Error('播放列表格式无效');
      // 只对真正的分片清单预取。主清单（#EXT-X-STREAM-INF）本身没有分片，
      // 在这里预取会额外多抓一层清单 + 12 个分片，一次播放请求向上游打十几个请求，
      // 很容易把源站打成限流，反而让紧随其后的请求失败。客户端马上就会自己请求子清单。
      if (!/#EXT-X-STREAM-INF/.test(text)) prefetchSegments(r.url || target, waitUntil, text);
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
