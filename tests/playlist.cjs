// 验证播放列表重写（functions/_lib/cinema.js 的 rewritePlaylist）。
// 背景：苹果CMS 系采集源的 m3u8 大量使用 #EXT-X-KEY:METHOD=AES-128,URI="enc.key"，
// 密钥是相对路径。旧实现只重写非注释行，浏览器会把密钥解析成 <本站>/online/media/enc.key
// 而拿到 410，导致整部片黑屏。此测试确保加密源的关键子资源都被代理。
const assert = require('node:assert');

const BASE = 'https://g.xlsyld.com:9999/hls/651/20250628/a1b2/index.m3u8';
const tokenOf = line => line.match(/URI="([^"]+)"/)?.[1]?.split('/').pop();
const segToken = line => line.trim().split('/').pop();

(async () => {
  const { rewritePlaylist, resolve } = await import('../functions/_lib/cinema.js');
  const secret = 'test-secret';

  const source = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x00000000000000000000000000000000',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="cn",URI="../audio/cn.m3u8"',
    '#EXTINF:10.0,',
    '/hls/651/20250628/a1b2/seg0.ts',
    '#EXTINF:10.0,',
    'seg1.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');

  const lines = (await rewritePlaylist(secret, source, BASE)).split('\n');

  // 1) 骨架行原样保留
  assert.equal(lines[0], '#EXTM3U');
  assert.equal(lines[2], '#EXT-X-TARGETDURATION:10');
  assert.equal(lines.at(-1), '#EXT-X-ENDLIST');

  // 2) AES-128 密钥被代理，且能反解回源站绝对地址
  const keyLine = lines.find(l => l.startsWith('#EXT-X-KEY'));
  assert.doesNotMatch(keyLine, /URI="enc\.key"/);
  assert.equal(await resolve(secret, tokenOf(keyLine)), 'https://g.xlsyld.com:9999/hls/651/20250628/a1b2/enc.key');

  // 3) 同行的其他属性（METHOD/IV）不能被破坏
  assert.match(keyLine, /^#EXT-X-KEY:METHOD=AES-128,URI="[^"]+",IV=0x0{32}$/);

  // 4) fMP4 初始化段与音轨清单同样被代理
  assert.equal(
    await resolve(secret, tokenOf(lines.find(l => l.startsWith('#EXT-X-MAP')))),
    'https://g.xlsyld.com:9999/hls/651/20250628/a1b2/init.mp4',
  );
  assert.equal(
    await resolve(secret, tokenOf(lines.find(l => l.startsWith('#EXT-X-MEDIA')))),
    'https://g.xlsyld.com:9999/hls/651/20250628/audio/cn.m3u8',
  );

  // 5) 绝对路径分片与相对路径分片都按播放列表所在目录解析
  const segs = lines.filter(l => l.trim() && !l.startsWith('#'));
  assert.equal(segs.length, 2);
  assert.equal(await resolve(secret, segToken(segs[0])), 'https://g.xlsyld.com:9999/hls/651/20250628/a1b2/seg0.ts');
  assert.equal(await resolve(secret, segToken(segs[1])), 'https://g.xlsyld.com:9999/hls/651/20250628/a1b2/seg1.ts');

  // 6) data: 内联密钥没有服务端资源可代，必须原样保留（否则被写成空 URI 会直接崩）
  const inline = await rewritePlaylist(secret, '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="data:text/plain;base64,AAAA"\n', BASE);
  assert.match(inline, /URI="data:text\/plain;base64,AAAA"/);

  // 7) 自适应码率主清单：标签行不能动，变体清单要按目录解析
  const master = await rewritePlaylist(secret, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720\n1080/index.m3u8\n', BASE);
  assert.match(master, /#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720/);
  const variant = master.split('\n').find(l => l.trim() && !l.startsWith('#'));
  assert.equal(await resolve(secret, segToken(variant)), 'https://g.xlsyld.com:9999/hls/651/20250628/a1b2/1080/index.m3u8');

  // 8) 过期/伪造 token 必须解不出来
  assert.equal(await resolve(secret, 'eyJ1IjoiaHR0cHM6Ly9ldmlsLnRlc3QveC5tM3U4IiwiZSI6OTk5OTk5OTk5OTk5OX0.deadbeefdeadbeefdeadbeef'), null);

  console.log('playlist rewrite verified');
})().catch(e => { console.error(e); process.exitCode = 1; });
