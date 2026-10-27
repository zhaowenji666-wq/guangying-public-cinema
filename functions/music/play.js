// B 站音频/视频直链代理：直链带 Referer 防盗链，浏览器直接请求会被拒。
export async function onRequest(context) {
  const { request } = context;
  const u = new URL(request.url).searchParams.get('u');
  if (!u || !/^https:\/\//.test(u)) return new Response('invalid', { status: 400 });
  const range = request.headers.get('range');
  const r = await fetch(u, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      Referer: 'https://www.bilibili.com/',
      ...(range ? { Range: range } : {}),
    },
  });
  const headers = new Headers(r.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(r.body, { status: r.status, headers });
}
