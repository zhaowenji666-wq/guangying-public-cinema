// 验证播放页还原逻辑（functions/_lib/rescue.js）。
// 这是「能搜到但播不了」问题的核心修复，必须有回归测试兜底。
const assert = require('node:assert');

// 用可控的假 fetch 替代真实网络：按 URL 返回预设内容
function withFetch(map, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const key = String(url);
    if (!(key in map)) return { ok: false, status: 404, text: async () => '' };
    const body = map[key];
    return { ok: true, status: 200, text: async () => body };
  };
  return fn().finally(() => { globalThis.fetch = original; });
}

const M3U8 = '#EXTM3U\n#EXT-X-VERSION:3\nseg0.ts\n';
const SHARE = 'https://site.test/share/abc123';

(async () => {
  const { rescuePlaylist } = await import('../functions/_lib/rescue.js');

  // 1) 补 /index.m3u8 即可拿到
  await withFetch({
    [SHARE]: '<html>播放器</html>',
    [SHARE + '/index.m3u8']: M3U8,
  }, async () => {
    assert.equal(await rescuePlaylist(SHARE), SHARE + '/index.m3u8');
  });

  // 2) m3u8 以相对路径写在页面里（电影天堂、量子等源的实际形态）
  const page = '<html><script>const url = "/20251221/8140_abc/index.m3u8?sign=xyz";</script></html>';
  await withFetch({
    [SHARE]: page,
    [SHARE + '/index.m3u8']: '<html>404</html>',
    'https://site.test/20251221/8140_abc/index.m3u8?sign=xyz': M3U8,
  }, async () => {
    assert.equal(await rescuePlaylist(SHARE), 'https://site.test/20251221/8140_abc/index.m3u8?sign=xyz');
  });

  // 3) 页面里是播放器的 hls.js 之类脚本，不应被误当成 m3u8
  await withFetch({
    [SHARE]: '<html><script src="/js/hls.js"></script></html>',
    [SHARE + '/index.m3u8']: '<html>404</html>',
  }, async () => {
    assert.equal(await rescuePlaylist(SHARE), null);
  });

  // 4) 页面里什么都没有，返回 null（调用方据此报错换源）
  await withFetch({
    [SHARE]: '<html>验证页</html>',
    [SHARE + '/index.m3u8']: '<html>404</html>',
  }, async () => {
    assert.equal(await rescuePlaylist(SHARE), null);
  });

  // 5) 网络异常不应抛出，仍返回 null
  await withFetch({}, async () => {
    assert.equal(await rescuePlaylist(SHARE), null);
  });

  console.log('playlist rescue verified');
})().catch(e => { console.error(e); process.exitCode = 1; });
