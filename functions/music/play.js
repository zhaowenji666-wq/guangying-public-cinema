import { kugouUrl } from '../_lib/music.js';

// 只按已校验的歌曲 hash 取流，不接受任意网址，避免开放代理/SSRF。
export async function onRequest(context) {
  const { request } = context;
  const p = new URL(request.url).searchParams;
  let media;
  try { media = await kugouUrl(p.get('hash')); }
  catch (e) { return new Response(e.message, { status: 400 }); }
  const range = request.headers.get('range');
  const r = await fetch(media.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Referer: 'https://m.kugou.com/',
      ...(range ? { Range: range } : {}),
    },
  });
  const headers = new Headers(r.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=900');
  headers.delete('Set-Cookie');
  return new Response(r.body, { status: r.status, headers });
}
