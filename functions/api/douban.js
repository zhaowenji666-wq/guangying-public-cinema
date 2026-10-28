import { json, UA } from '../_lib/cinema.js';

const headers = { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://m.douban.com/' };
const clean = value => String(value || '').replace(/<[^>]*>/g, '').trim();

export const mapHot = row => ({
  id: String(row.id || row.target?.id || ''), title: clean(row.title || row.target?.title),
  year: String(row.year || row.target?.year || '').match(/\d{4}/)?.[0] || '',
  poster: row.cover?.url || row.pic?.normal || row.target?.cover_url || '',
  rating: Number(row.rating?.value || row.target?.rating?.value || 0),
  ratingCount: Number(row.rating?.count || row.target?.rating?.count || 0),
  kind: /tv|电视剧|综艺/.test(String(row.type || row.target_type || row.target?.type)) ? 'series' : 'film',
});

export const mapSearch = row => ({
  id: String(row.target?.id || row.id || ''), title: clean(row.target?.title || row.title), year: String(row.target?.year || row.year || '').match(/\d{4}/)?.[0] || '',
  poster: row.target?.cover_url || row.pic?.normal || row.cover_url || '', rating: Number(row.target?.rating?.value || row.rating?.value || 0),
  ratingCount: Number(row.target?.rating?.count || row.rating?.count || 0), kind: /tv/.test(String(row.target_type || row.type)) ? 'series' : 'film',
});

async function get(url) {
  const r = await fetch(url, { headers, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!r.ok) throw Error('豆瓣返回 ' + r.status);
  return r.json();
}

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url), q = url.searchParams.get('q')?.trim();
    if (q) {
      const data = await get('https://m.douban.com/rexxar/api/v2/search/subjects?' + new URLSearchParams({ q }));
      return json({ results: (data.subjects?.items || data.subjects || []).map(mapSearch).filter(x => x.id && x.title).slice(0, 20) });
    }
    const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
    const collection = type === 'tv' ? 'tv_hot' : 'movie_hot_gaia';
    const data = await get(`https://m.douban.com/rexxar/api/v2/subject_collection/${collection}/items?start=0&count=20&items_only=1&for_mobile=1`);
    return json({ type, results: (data.subject_collection_items || []).map(mapHot).filter(x => x.id && x.title) });
  } catch (error) { return json({ error: error.message || '豆瓣数据暂不可用' }, 502); }
}
