// 音乐源：B 站音乐内容。
// 说明：洛雪/MusicFree 的音源脚本依赖宿主 App 环境（globalThis.lx / MusicFree 插件运行时），
// 无法在网页里直接运行；其后端 lxmusicapi.onrender.com 为 Render 免费实例，已休眠（503）。
// B 站音乐区是实测稳定可用的替代方案，且本项目已有 B 站弹幕调用基础。
// B 站接口对服务端请求会返回 412，需要带 buvid3 标识才放行。
let buvid = '';
function buvidCookie() {
  if (!buvid) buvid = crypto.randomUUID().toUpperCase() + '-infoc';
  return 'buvid3=' + buvid + '; b_nut=1700000000';
}
const BILI = () => ({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
  Cookie: buvidCookie(),
});
const plain = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function bili(url) {
  const r = await fetch(url, { headers: BILI(), cf: { cacheTtl: 0, cacheEverything: false, polish: 'off' } });
  if (!r.ok) throw Error('B 站接口返回 ' + r.status);
  const j = await r.json();
  if (j.code !== 0) throw Error(j.message || 'B 站接口异常');
  return j.data;
}

// search_type=video 并限定音乐分区(tid=3)，或按关键词搜索
export async function musicSearch(keyword, page = 1) {
  const q = String(keyword || '').trim().slice(0, 60);
  if (!q) throw Error('请输入歌曲或歌手名');
  const url = 'https://api.bilibili.com/x/web-interface/search/type?' + new URLSearchParams({
    search_type: 'video', keyword: q, page: String(page), order: 'totalrank',
  });
  const data = await bili(url);
  const list = (data.result || []).slice(0, 30);
  return list.map(v => ({
    bvid: v.bvid,
    title: plain(v.title),
    author: plain(v.author),
    duration: v.duration,
    cover: v.pic ? v.pic.replace(/^http:/, 'https:') : '',
    play: v.play,
    pubdate: v.pubdate,
  }));
}

export async function musicParts(bvid) {
  if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) throw Error('BV 号无效');
  const data = await bili('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
  return {
    bvid,
    title: plain(data.title),
    author: plain(data.owner?.name),
    cover: data.pic ? data.pic.replace(/^http:/, 'https:') : '',
    parts: (data.pages || []).map(p => ({ cid: p.cid, title: plain(p.part), page: p.page })),
  };
}

// 返回 B 站音频/视频直链。注意：B 站直链有 Referer 防盗链，必须经本站代理播放。
export async function musicUrl(bvid, cid) {
  if (!/^BV[a-zA-Z0-9]{10}$/.test(bvid)) throw Error('BV 号无效');
  if (!/^\d{1,15}$/.test(String(cid))) throw Error('分集标识无效');
  const url = 'https://api.bilibili.com/x/player/playurl?' + new URLSearchParams({
    bvid, cid: String(cid), qn: '16', fnval: '1', fourk: '0',
  });
  const data = await bili(url);
  const durl = data.durl || [];
  if (!durl.length) throw Error('没有可播放的音频流');
  return { url: durl[0].url, size: durl[0].size, backup: (durl[1]?.url) || '' };
}
