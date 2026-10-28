import { kugouUrl } from '../../_lib/music.js';
import { json } from '../../_lib/cinema.js';
export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  try {
    const data = await kugouUrl(p.get('hash'));
    // 不把直链交给浏览器，播放端只接受已校验的歌曲 hash，避免成为任意网址代理。
    return json({ size: data.size, proxy: '/music/play?' + new URLSearchParams({ hash: p.get('hash') }) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
