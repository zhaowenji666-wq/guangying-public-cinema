const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 音乐播放代理只接受已校验的歌曲标识（酷狗 hash / 网易云 ncm:<id>），不能退化为任意 URL 代理。
const play = fs.readFileSync(path.join(__dirname, '../functions/music/play.js'), 'utf8');
assert.doesNotMatch(play, /searchParams\.get\(['"]u['"]\)/);
assert.match(play, /kugouUrl\(/);
assert.match(play, /ncmUrl\(/);
assert.match(play, /id\.startsWith\('ncm:'\)/);
const media = fs.readFileSync(path.join(__dirname, '../functions/online/media/[[token]].js'), 'utf8');
const online = fs.readFileSync(path.join(__dirname, '../web/online.js'), 'utf8');
assert.doesNotMatch(media, /prefetchSegments/);
assert.doesNotMatch(online, /warmSegments/);
assert.match(online, /best\?\.details\|\|\(chosen\.episodes\?\.length\?chosen:null\)/);
assert.match(online, /Promise\.any/);
assert.match(online, /4K/);
assert.match(online, /Hls\.Events\.LEVEL_SWITCHED/);
// 高倍速不再降画质：speedQualityLimit 已移除
assert.doesNotMatch(online,/speedQualityLimit/);
assert.match(online,/abrEwmaDefaultEstimate:12000000/); // ABR 起步按高带宽估，快速升到最高档
assert.match(online,/capLevelToPlayerSize:false/); // 不按窗口尺寸降档
const onlineHtml=fs.readFileSync(path.join(__dirname, '../web/online.html'), 'utf8');
for(const speed of ['0.75','1','1.25','1.5','2','3','4'])assert.match(onlineHtml,new RegExp(`value="${speed.replace('.','\\.')}"`));
for(const quality of ['720','1080','1440','2160'])assert.match(onlineHtml,new RegExp(`value="${quality}"`));
assert.match(onlineHtml, /id="source-quality"/);
assert.match(onlineHtml, /id="fs-overlay"/); // 全屏内画质/选集/倍速
assert.match(onlineHtml, /id="fs-quality-panel"/);
assert.match(onlineHtml, /id="fs-episodes-panel"/);
assert.match(online, /chooseSourceQuality/);
assert.match(online, /const inferredQuality=/);
assert.doesNotMatch(online, /响应 \d+ms/); // 用户体验:不暴露响应耗时
const customSources=JSON.parse(fs.readFileSync(path.join(__dirname, '../sources.custom.json'),'utf8')).api_site;
assert.equal(Object.values(customSources).some(source=>source.adult),false);
const generatedSources=fs.readFileSync(path.join(__dirname, '../functions/_sources.js'),'utf8');
assert.doesNotMatch(generatedSources,/slapibf|fhapi9|专类资源|凤凰资源/);
const cinema=fs.readFileSync(path.join(__dirname, '../functions/_lib/cinema.js'),'utf8');
assert.match(cinema,/成人视频/);
assert.doesNotMatch(cinema,/source\.adult\s*\|\|/);
assert.match(online, /连接较慢，正在为您优化播放线路/);
assert.match(online, /video\.readyState>=3&&!video\.paused/);
const radio = fs.readFileSync(path.join(__dirname, '../web/radio.js'), 'utf8');
assert.match(radio, /\/api\/music\/search/);
assert.match(radio, /\/api\/music\/url/);
assert.match(radio, /item\.preview/);
assert.match(radio, /version!==searchVersion\|\|mode!==currentMode/);
const search = fs.readFileSync(path.join(__dirname, '../functions/api/music/search.js'), 'utf8');
assert.match(search, /previewSearch/);
console.log('music proxy boundary verified');
