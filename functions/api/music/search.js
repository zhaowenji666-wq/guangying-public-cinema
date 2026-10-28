import { previewSearch, ncmSearch } from '../../_lib/music.js';
import { json } from '../../_lib/cinema.js';

// 歌曲搜索合并两个来源：
//  - 网易云（完整歌曲，曲库最全）优先
//  - Apple Music 试听（30 秒，兜底）
// 任一来源失败不影响另一个，两路都失败才报错。
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  if (!q) return json({ error: '请输入歌曲或歌手名' }, 400);
  const [ncm, apple] = await Promise.allSettled([ncmSearch(q, 20), previewSearch(q)]);
  const results = [
    ...(ncm.status === 'fulfilled' ? ncm.value : []),
    ...(apple.status === 'fulfilled' ? apple.value : []),
  ];
  if (!results.length) {
    const reason = [ncm, apple].filter(x => x.status === 'rejected').map(x => x.reason?.message).join('；');
    return json({ error: reason || '未找到歌曲', results: [] }, 502);
  }
  return json({ results, source: 'ncm+apple-preview' });
}
