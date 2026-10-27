// 直播频道清单的结构校验（离线，不联网）
// 覆盖：字段完整、URL 必须 https（否则 https 页面会被混合内容拦截）、无重名、分组合法、生成模块与源文件一致
process.on('unhandledRejection', e => { console.error('FAIL', e); process.exit(1); });

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const base = path.join(__dirname, '..');
const src = JSON.parse(fs.readFileSync(path.join(base, 'live-sources.json'), 'utf8'));
const chs = src.channels || [];
const GROUPS = new Set(['央视与CGTN', '卫视', '影视与纪录', '地方台']);

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

console.log('live sources');

test('频道数量在合理区间', () => {
  assert(Array.isArray(chs) && chs.length >= 30, '频道过少：' + chs.length);
});

test('每个频道字段完整', () => {
  for (const c of chs) {
    assert(c.name && typeof c.name === 'string', '缺少 name');
    assert(c.group && GROUPS.has(c.group), '分组非法：' + c.group + ' / ' + c.name);
    assert(/^https:\/\//.test(c.url), '必须 https（混合内容会被浏览器拦截）：' + c.name + ' ' + c.url);
  }
});

test('频道名不重复', () => {
  const seen = new Set();
  for (const c of chs) {
    assert(!seen.has(c.name), '重名频道：' + c.name);
    seen.add(c.name);
  }
});

test('生成的 live-channels.js 与源文件一致', () => {
  const p = path.join(base, 'web', 'live-channels.js');
  assert(fs.existsSync(p), '缺少 web/live-channels.js，请先运行 npm run sync:live');
  const text = fs.readFileSync(p, 'utf8');
  const m = text.match(/window\.LIVE_CHANNELS = (\{[\s\S]*\});/);
  assert(m, '生成的模块格式不正确');
  const mod = JSON.parse(m[1]);
  assert(mod.channels.length === chs.length, `频道数不一致：模块 ${mod.channels.length} vs 源文件 ${chs.length}`);
});

test('页面引用的频道模块存在', () => {
  const html = fs.readFileSync(path.join(base, 'web', 'live.html'), 'utf8');
  assert(html.includes('/live-channels.js'), 'live.html 未引用 live-channels.js');
  assert(html.includes('/live.js'), 'live.html 未引用 live.js');
});

console.log(`\n${n} tests passed`);
