const BASE='https://guangying-cinema-c1l.pages.dev';
// 1) 完整复现用户行为:搜索→取URL→按radio.js的方式播放
const q='晴天';
const s=await (await fetch(`${BASE}/api/music/search?q=${encodeURIComponent(q)}`,{signal:AbortSignal.timeout(50000)})).json();
const ncm=s.results?.find(x=>x.source==='ncm');
console.log('首条网易云:',ncm?(ncm.id+' '+ncm.title):'无');
if(!ncm){console.log('网易云无结果,搜索错误:',s.error);process.exit(0);}
// 2) /api/music/url
const u=await (await fetch(`${BASE}/api/music/url?id=${encodeURIComponent(ncm.id)}`,{signal:AbortSignal.timeout(50000)})).json();
console.log('url接口:',u.error?('✗ '+u.error):('proxy='+u.proxy));
// 3) 模拟浏览器<audio>行为:先无Range的GET(浏览器经常这样探测),再带Range
if(u.proxy){
  console.log('\n--- 模拟audio: 无Range GET(浏览器典型探测) ---');
  const t0=Date.now();
  const r1=await fetch(BASE+u.proxy,{signal:AbortSignal.timeout(60000)});
  console.log('状态:',r1.status,'| content-type:',r1.headers.get('content-type'),'| content-length:',r1.headers.get('content-length'),'| 耗时',(Date.now()-t0)+'ms');
  // 读一小段看是否真的有body在流
  const reader=r1.body.getReader();
  const first=await reader.read();
  console.log('首块字节:',first.value?.length??0,'首2字节:',first.value?(first.value[0]+','+first.value[1]):'-');
  await reader.cancel();
  console.log('\n--- 带Range GET ---');
  const r2=await fetch(BASE+u.proxy,{headers:{Range:'bytes=0-65535'},signal:AbortSignal.timeout(60000)});
  const b2=await r2.arrayBuffer();
  console.log('状态:',r2.status,'字节:',b2.byteLength,'content-range:',r2.headers.get('content-range'));
}
