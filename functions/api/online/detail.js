import { sources, query, json, secretOf } from '../../_lib/cinema.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const secret = secretOf(env);
  const source = sources.find(s => s.id === url.searchParams.get('source'));
  if (!source) return json({ error: '片源不存在' }, 400);
  const q = (url.searchParams.get('id') || '').trim().slice(0, 120);
  if (!q) return json({ error: '请输入片名' }, 400);
  try {
    let results = await query(secret, source, { ac: 'detail', ids: q });
    if (!results.some(m => m.episodes.length)) results = await query(secret, source, { ac: 'videolist', ids: q });
    return json({ results });
  } catch (e) {
    return json({ error: e.message, results: [] }, 502);
  }
}
