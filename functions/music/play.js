import { kugouUrl, ncmUrl } from '../_lib/music.js';

// 音乐播放代理：只按已校验的歌曲标识取流（酷狗 hash / 网易云 ncm:<id>），
// 不接受任意网址，避免开放代理/SSRF。网易云直链有时效，播放端每次经此实时换取。
export async function onRequest(context) {
  const { request } = context;
  const p = new URL(request.url).searchParams;
  const id = (p.get('id') || '').trim();   // ncm:<songId>
  const hash = (p.get('hash') || '').trim(); // 酷狗 hash
  const range = request.headers.get('range');
  let media, referer = '';
  try {
    if (id.startsWith('ncm:')) {
      const level = (p.get('level') || 'standard').trim();
      media = await ncmUrl(id, level);
    } else {
      media = await kugouUrl(hash || id);
      referer = 'https://m.kugou.com/';
    }
  } catch (e) { return new Response(e.message, { status: 400 }); }
  const r = await fetch(media.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      ...(referer ? { Referer: referer } : {}),
      ...(range ? { Range: range } : {}),
    },
  });
  const headers = new Headers(r.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=900');
  headers.delete('Set-Cookie');
  return new Response(r.body, { status: r.status, headers });
}
