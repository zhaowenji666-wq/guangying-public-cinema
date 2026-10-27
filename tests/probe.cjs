const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('web/online.js','utf8');
const code=src.slice(src.indexOf('async function probeSource('),src.indexOf('async function autoFailover('));
let tick=0;
const ctx={performance:{now:()=>++tick},AbortSignal:{timeout:()=>null},URL,URLSearchParams,location:{origin:'https://site.test'},mediaKind:()=> 'film',fetch:async url=>{
 if(String(url).includes('/detail?')){const p=new URL(url,'https://site.test').searchParams;return {ok:true,json:async()=>({results:[{id:p.get('id'),episodes:[{title:'正片',url:'/media/'+p.get('id')}]}]})};}
 if(String(url).endsWith('/bad'))return {ok:false};
 return {ok:true,headers:{get:()=> 'video/mp2t'},body:{getReader:()=>({read:async()=>({value:new Uint8Array([1,2])}),cancel:async()=>{}})}};
}};
const {probeSource,fastestSource}=vm.runInNewContext(code+';({probeSource,fastestSource})',ctx);
(async()=>{const bad={id:'bad',source:'a'},good={id:'good',source:'b'};await assert.rejects(probeSource(bad));assert.equal((await fastestSource([bad,good])).movie.id,'good');await assert.rejects(probeSource(good,'第20集',20));console.log('probe handles failures and episode mismatch');})().catch(e=>{console.error(e);process.exitCode=1});
