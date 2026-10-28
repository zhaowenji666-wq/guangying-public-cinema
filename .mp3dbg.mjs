const BASE='https://guangying-cinema-c1l.pages.dev';
// 检查代理输出的前16字节hex
const u=await (await fetch(`${BASE}/api/music/url?id=${encodeURIComponent('ncm:2652820720')}`,{signal:AbortSignal.timeout(50000)})).json();
console.log('proxy:',u.proxy);
const r=await fetch(BASE+u.proxy,{headers:{Range:'bytes=0-255'},signal:AbortSignal.timeout(50000)});
const b=new Uint8Array(await r.arrayBuffer());
console.log('经代理 状态:',r.status,'字节:',b.byteLength);
console.log('hex(前16):',[...b.slice(0,16)].map(x=>x.toString(16).padStart(2,'0')).join(' '));
console.log('ASCII:',JSON.stringify(String.fromCharCode(...b.slice(0,20))));
// 同时测代理本地复刻:直接跑 play.js 的逻辑
import('./functions/music/play.js').catch(()=>{});
