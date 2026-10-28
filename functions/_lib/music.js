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
    cover: v.pic ? v.pic.replace(/^http:/, 'https:').replace(/^\/\//, 'https://') : '',
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
    cover: data.pic ? data.pic.replace(/^http:/, 'https:').replace(/^\/\//, 'https://') : '',
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

const KUGOU_UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const songHash = value => /^[a-f0-9]{32}$/i.test(String(value || '')) ? String(value).toUpperCase() : '';
const duration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// 无需账号的官方公开试听；酷狗在 Cloudflare 机房偶尔会拒绝播放地址，用它保证搜索始终有可播结果。
export async function previewSearch(keyword) {
  const q = String(keyword || '').trim().slice(0, 60);
  if (!q) throw Error('请输入歌曲或歌手名');
  const url = 'https://itunes.apple.com/search?' + new URLSearchParams({
    term: q, media: 'music', entity: 'song', limit: '30', country: 'HK', lang: 'zh_cn',
  });
  const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw Error('歌曲搜索返回 ' + r.status);
  const data = await r.json();
  return (data.results || []).flatMap(item => {
    const preview = String(item.previewUrl || '');
    if (!/^https:\/\/audio-ssl\.itunes\.apple\.com\//i.test(preview)) return [];
    return [{ id: String(item.trackId || preview), title: plain(item.trackName), author: plain(item.artistName),
      album: plain(item.collectionName), duration: '试听 30 秒', cover: String(item.artworkUrl100 || '').replace('100x100bb', '240x240bb'),
      preview, source: String(item.trackViewUrl || ''), provider: 'Apple Music 试听' }];
  });
}

// go-music-api/music-lib 的酷狗线路可以无登录搜索并获取普通音质，适合当前无状态 Pages Functions。
export async function kugouSearch(keyword, page = 1) {
  const q = String(keyword || '').trim().slice(0, 60);
  if (!q) throw Error('请输入歌曲或歌手名');
  const url = 'https://songsearch.kugou.com/song_search_v2?' + new URLSearchParams({
    keyword: q, platform: 'WebFilter', format: 'json', page: String(page), pagesize: '30',
    userid: '-1', tag: 'em', filter: '2', iscorrection: '1', privilege_filter: '0',
  });
  const r = await fetch(url, { headers: { 'User-Agent': KUGOU_UA }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw Error('歌曲搜索返回 ' + r.status);
  const data = await r.json();
  const candidates = (data.data?.lists || []).flatMap(item => {
    const hash = songHash(item.FileHash || item.HQFileHash || item.SQFileHash);
    if (!hash) return [];
    return [{ hash, title: plain(item.SongName), author: plain(item.SingerName), album: plain(item.AlbumName),
      duration: duration(Number(item.Duration) || 0), cover: String(item.Image || '').replace('{size}', '240').replace(/^http:/, 'https:'), source: 'kugou' }];
  });
  // 搜索目录会混入只有会员才可播放的条目。并行预检后只展示当前确实能播放的歌曲，
  // 避免用户逐条点开才发现“有结果、没声音”。
  const checked = await Promise.all(candidates.map(async item => {
    try { await kugouUrl(item.hash, 120); return item; } catch { return null; }
  }));
  return checked.filter(Boolean);
}

export async function kugouUrl(hash, cacheTtl = 0) {
  hash = songHash(hash);
  if (!hash) throw Error('歌曲标识无效');
  const r = await fetch('https://m.kugou.com/app/i/getSongInfo.php?' + new URLSearchParams({ cmd: 'playInfo', hash }), {
    headers: { 'User-Agent': KUGOU_UA, Referer: 'https://m.kugou.com/' }, cf: { cacheTtl },
  });
  if (!r.ok) throw Error('播放地址返回 ' + r.status);
  const data = await r.json(), url = String(data.url || '');
  if (data.errcode || !/^https:\/\//i.test(url)) throw Error('这首歌暂时没有可播放的普通音质');
  return { url, size: Number(data.fileSize) || 0 };
}
