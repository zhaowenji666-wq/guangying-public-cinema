const BASE='https://guangying-cinema-c1l.pages.dev';
for(let i=1;i<=3;i++){
  // 每轮重新取(直链有时效),既测无Range也测Range
  const u=await (await fetch(`${BASE}/api/music/url?id=${encodeURIComponent('ncm:2652820720')}`,{signal:AbortSignal.timeout(50000)})).json();
  if(!u.proxy){console.log(`第${i}轮 url接口失败:`,u.error);continue;}
  const r=await fetch(BASE+u.proxy,{signal:AbortSignal.timeout(60000)});
  const reader=r.body.getReader();
  const first=await reader.read();
  const b=first.value||new Uint8Array(0);
  const hex=[...b.slice(0,8)].map(x=>x.toString(16).padStart(2,'0')).join(' ');
  const ascii=String.fromCharCode(...b.slice(0,8)).replace(/[^\x20-\x7e]/g,'.');
  console.log(`第${i}轮 无Range: ${r.status} len=${r.headers.get('content-length')} 首8字节: ${hex} "${ascii}"`);
  await reader.cancel();
}
