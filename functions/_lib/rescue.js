// 从采集站的播放页里还原真实的 m3u8 地址。
// 现象：不少源给的播放地址形如 https://xx.com/share/<id>，直接请求返回 text/html 播放页，
// 真实 m3u8 要么需要补 /index.m3u8 后缀，要么以相对路径写在页面的 JS 变量里。
//
// 实测上游抖动明显（同一地址连续请求会出现 成功/失败/成功 交替），所以每个候选都重试。
// 页面本身同样会抽风（ECONNRESET / 5xx），早期版本只请求一次、失败就直接放弃，
// 会把「其实能播但刚好抖动了一下」的源误判成坏源，因此页面也一并重试。
import { mediaHeaders } from './cinema.js';

const M3U8_RE = /(?:https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)\.m3u8[^\s"'<>]*/g;
const HEADERS = mediaHeaders();

// 4xx 是确定性错误（地址不对），重试没意义；5xx / 网络错误 / 429 才重试。
const retryable = status => status === 429 || status >= 500;

async function get(url, tries = 1) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const text = await r.text();
      if (r.ok && text.trimStart().startsWith('#EXTM3U')) return { ok: true, text };
      last = text;
      if (r.status >= 400 && r.status < 500 && r.status !== 429) return { ok: false, text: '' };
    } catch (e) { last = ''; }
  }
  return { ok: false, text: last || '' };
}

async function page(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return await r.text();
      if (!retryable(r.status)) return '';
    } catch { /* 抖一下就再试 */ }
  }
  return '';
}

export async function rescuePlaylist(url) {
  const base = url.replace(/\/+$/, '');

  // 1) 最省事的规律：补 /index.m3u8
  const direct = await get(base + '/index.m3u8', 2);
  if (direct.ok) return base + '/index.m3u8';

  // 2) 解析播放页里嵌的 m3u8（多为相对路径，如 /20251221/xxx/index.m3u8?sign=...）
  const html = await page(url);
  if (!html) return null;

  const found = [...html.matchAll(M3U8_RE)]
    .map(m => m[0])
    .filter(u => !/\.(js|css)$/i.test(u));
  for (const u of found.slice(0, 3)) {
    const abs = /^https?:/i.test(u) ? u : new URL(u, url).href;
    if (abs === base || abs === url) continue;
    const hit = await get(abs, 2);
    if (hit.ok) return abs;
  }
  return null;
}
