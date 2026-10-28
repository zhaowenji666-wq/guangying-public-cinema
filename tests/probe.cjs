const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('web/online.js','utf8');
const code=src.slice(src.indexOf('async function probeSource('),src.indexOf('async function autoFailover('));
let tick=0;
const ctx={performance:{now:()=>++tick},AbortSignal:{timeout:()=>null},URL,URLSearchParams,location:{origin:'https://site.test'},mediaKind:()=> 'film',sourceRank:()=>0,inferredQuality:m=>/4K/i.test(m.remarks||'')?2160:0,setTimeout:fn=>(fn(),0),fetch:async url=>{
 const value=String(url);
 if(value.includes('/detail?')){const p=new URL(value,'https://site.test').searchParams;return {ok:true,json:async()=>({results:[{id:p.get('id'),episodes:[{title:'正片',url:'/media/'+p.get('id')+'/master.m3u8'}]}]})};}
 if(value.includes('/bad/'))return {ok:false};
 if(value.endsWith('master.m3u8')){const height=value.includes('/high/')?2160:value.includes('/low/')?720:1080;return {ok:true,headers:{get:()=> 'application/vnd.apple.mpegurl'},text:async()=>`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x${height}\nvideo.m3u8`};}
 if(value.endsWith('video.m3u8'))return {ok:true,headers:{get:()=> 'application/vnd.apple.mpegurl'},text:async()=> '#EXTM3U\n#EXTINF:5,\nseg.ts'};
 return {ok:true,headers:{get:()=> 'video/mp2t'},body:{getReader:()=>({read:async()=>({value:new Uint8Array([1,2])}),cancel:async()=>{}})}};
}};
const {probeSource,sourceScore,fastestSource}=vm.runInNewContext(code+';({probeSource,sourceScore,fastestSource})',ctx);
(async()=>{const bad={id:'bad',source:'a'},good={id:'good',source:'b'},low={id:'low',source:'c'},high={id:'high',source:'d'},tagged={id:'good',source:'e',remarks:'4K'};await assert.rejects(probeSource(bad));assert.equal((await probeSource(good)).height,1080);assert.equal((await probeSource(tagged)).height,2160);assert.equal((await fastestSource([low,high])).movie.id,'high');assert(sourceScore({height:1080,ms:500},1080)>sourceScore({height:2160,ms:500},1080));assert(sourceScore({height:2160,ms:8000})<sourceScore({height:1080,ms:500}));await assert.rejects(probeSource(good,'第20集',20));console.log('probe combines target resolution and response speed');})().catch(e=>{console.error(e);process.exitCode=1});
