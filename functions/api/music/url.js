import { musicUrl } from '../../_lib/music.js';
import { json } from '../../_lib/cinema.js';
export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  try {
    const data = await musicUrl(p.get('bvid'), p.get('cid'));
    // B 站直链有 Referer 防盗链，必须经本站 /music/play 代理
    return json({ ...data, proxy: '/music/play?u=' + encodeURIComponent(data.url) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
