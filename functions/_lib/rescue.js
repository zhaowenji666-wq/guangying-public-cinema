// 从采集站的播放页里还原真实的 m3u8 地址。
// 现象：不少源给的播放地址形如 https://xx.com/play/<id>，直接请求返回 text/html 播放页，
// 真实播放列表要么藏在页面里，要么需要补 /index.m3u8 后缀。
const M3U8_RE = /https?:[^\s"'<>]+\.m3u8[^\s"'<>]*/g;

export async function rescuePlaylist(url) {
  // 先试最省事的规律：补 /index.m3u8
  for (const candidate of [url.replace(/\/+$/, '') + '/index.m3u8', url]) {
    try {
      const r = await fetch(candidate, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) continue;
      const text = await r.text();
      if (text.trimStart().startsWith('#EXTM3U')) return candidate;
    } catch {}
  }
  // 再解析页面内容里嵌的 m3u8
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const text = await r.text();
    const found = [...text.matchAll(M3U8_RE)].map(m => m[0]);
    for (const u of found.slice(0, 3)) {
      const abs = /^https?:/i.test(u) ? u : new URL(u, url).href;
      try {
        const p = await fetch(abs, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const body = await p.text();
        if (body.trimStart().startsWith('#EXTM3U')) return abs;
      } catch {}
    }
  } catch {}
  return null;
}
