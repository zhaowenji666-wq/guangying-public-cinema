import { musicSearch } from '../../_lib/music.js';
import { json } from '../../_lib/cinema.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  if (!q) return json({ error: '请输入歌曲或歌手名' }, 400);
  try {
    const list = await musicSearch(q, Number(url.searchParams.get('page')) || 1);
    return json({ results: list, source: 'bilibili' });
  } catch (e) {
    return json({ error: e.message, results: [] }, 502);
  }
}
