import { kugouUrl, ncmUrl } from '../../_lib/music.js';
import { json } from '../../_lib/cinema.js';

// 按来源取播放地址，统一返回本站代理路径（不把直链交给浏览器，避免开放代理/SSRF）。
//  - 酷狗：hash 标识
//  - 网易云：ncm:<数字id> 标识
export async function onRequest(context) {
  const p = new URL(context.request.url).searchParams;
  const id = (p.get('id') || '').trim();
  const hash = (p.get('hash') || '').trim();
  try {
    if (id.startsWith('ncm:')) {
      const level = (p.get('level') || 'standard').trim();
      const data = await ncmUrl(id, level);
      const levelLabel = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' }[level] || '';
      return json({
        size: data.size, br: data.br, type: data.type,
        proxy: '/music/play?' + new URLSearchParams({ id }),
      });
    }
    const data = await kugouUrl(hash || id);
    return json({ size: data.size, proxy: '/music/play?' + new URLSearchParams({ hash: hash || id }) });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
