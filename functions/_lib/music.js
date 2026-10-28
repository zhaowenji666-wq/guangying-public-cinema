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
  const r = await fetch(url, { cf: { cacheTtl: 1800, cacheEverything: true } });
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

// ---------------- 网易云音乐（api-enhanced）----------------
// 上游：https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced（公共实例）
// 实测结论：
//  - 搜索 /cloudsearch 匿名可用；
//  - 播放地址 /song/url/v1 匿名直连一律 code=404，必须同时满足：
//    (1) 带匿名账号 cookie（/register/anonimous 免费、可重复领取）
//    (2) 请求参数 randomCNIP=true（走国内随机 IP 出口）
//  - 直链无 Referer 防盗链，但按平台规则不放直链给浏览器，一律经 /music/play 代理。
//  - 匿名档位实际给到 128k（无损需 VIP cookie，自动降级为可播的最高档）。
const NCM_BASE = 'https://ncm-api-enhanced.vercel.app';
let ncmCookie = '';
let ncmCookieAt = 0;

async function ncmAnonCookie(force = false) {
  // 匿名 cookie 长期有效，进程内缓存即可；边缘实例多副本时各自领一份也无妨。
  if (!force && ncmCookie && Date.now() - ncmCookieAt < 7 * 24 * 3600 * 1000) return ncmCookie;
  // 实测该端点随机限流（匿名注册 10 连打成功率约 40%，code=400 与成功交替），
  // 但「随机 username + 退避重试」5 轮验证 5/5 全成功。重试 5 次，退避 0.8s/1.6s/2.4s/3.2s。
  let d = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const username = 'gy' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try {
      const r = await fetch(NCM_BASE + '/register/anonimous?' + new URLSearchParams({ username }), {
        cf: { cacheTtl: 0 },
      });
      if (r.ok) {
        const data = await r.json();
        if (data.code === 200 && data.cookie) { d = data; break; }
      }
    } catch { /* 网络抖动，继续重试 */ }
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 800 * attempt));
  }
  if (!d) throw Error('网易云匿名登录暂不可用');
  const pairs = String(d.cookie).split(';;')
    .map(p => p.split(';')[0])
    .filter(p => /^[^=]+=[^;]/.test(p));
  ncmCookie = [...new Set(pairs)].join('; ');
  ncmCookieAt = Date.now();
  return ncmCookie;
}

async function ncmGet(path, cookie) {
  const r = await fetch(NCM_BASE + path, {
    headers: { Cookie: cookie },
    cf: { cacheTtl: 0 },
  });
  if (!r.ok) throw Error('网易云接口返回 ' + r.status);
  return r.json();
}

const NCM_FEE_LABEL = { 0: '', 1: 'VIP', 4: '购买专辑', 8: '免费' };

const ncmSearchCache = new Map(); // 关键词 → {at, list}
export async function ncmSearch(keyword, limit = 20) {
  const q = String(keyword || '').trim().slice(0, 60);
  if (!q) throw Error('请输入歌曲或歌手名');
  const cacheKey = q + '|' + limit;
  const hit = ncmSearchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 600000) return hit.list;
  const cookie = await ncmAnonCookie();
  const d = await ncmGet('/cloudsearch?' + new URLSearchParams({ keywords: q, limit: String(limit) }), cookie);
  const songs = d.result?.songs || [];
  return songs.map(s => {
    const artists = (s.ar || s.artists || []).map(a => a.name).filter(Boolean);
    const album = (s.al || s.album || {}).name || '';
    const sec = Math.round((s.duration || 0) / 1000);
    return {
      id: 'ncm:' + s.id,
      title: String(s.name || '').replace(/<[^>]*>/g, ''),
      author: artists.slice(0, 3).join('/'),
      album,
      duration: sec ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '',
      cover: ((s.al || s.album || {}).picUrl || '').replace(/^http:/, 'https:'),
      fee: NCM_FEE_LABEL[s.fee] ?? '',
      provider: '网易云',
      source: 'ncm',
    };
  }).filter(x => x.title);
  if (ncmSearchCache.size > 200) ncmSearchCache.clear();
  ncmSearchCache.set(cacheKey, { at: Date.now(), list });
  return list;
}

// 返回直链（不直接下发给浏览器，仅由 /music/play 代理使用）。
// 失败自动强制刷新匿名 cookie 重试一次，规避匿名会话偶发失效。
export async function ncmUrl(id, level = 'standard') {
  const songId = String(id).replace(/^ncm:/, '');
  if (!/^\d{4,20}$/.test(songId)) throw Error('网易云歌曲标识无效');
  if (!/^(standard|higher|exhigh|lossless|hires)$/.test(level)) level = 'standard';
  let cookie = await ncmAnonCookie();
  const attempt = async (ck, withCnIp) => ncmGet(
    '/song/url/v1?' + new URLSearchParams({ id: songId, level, randomCNIP: withCnIp ? 'true' : 'false' }), ck);
  let data = await attempt(cookie, true);
  let item = data.data?.[0];
  if (!item?.url) {
    // 换新匿名身份再试一次
    cookie = await ncmAnonCookie(true);
    data = await attempt(cookie, true);
    item = data.data?.[0];
  }
  let url = String(item?.url || '');
  if (!/^https?:\/\//i.test(url)) throw Error(data.message || item?.message || '这首歌暂时无法播放');
  // 网易云经常下发 http:// 直链；本站全部经 /music/play 代理，代理侧强制升级 https。
  url = url.replace(/^http:\/\//i, 'https://');
  return { url, size: Number(item.size) || 0, type: String(item.type || 'mp3'), br: Number(item.br) || 0 };
}
