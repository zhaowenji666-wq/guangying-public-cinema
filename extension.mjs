// Independent local enhancement service; never restarts the main playback server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sources,query,remote,register,mediaSource,decodeBody,onlineRoute} from './online.mjs';
const base=path.dirname(fileURLToPath(import.meta.url)),origin='http://localhost:3000';
const healthFile=path.join(base,'source-health.json');
let report=fs.existsSync(healthFile)?JSON.parse(fs.readFileSync(healthFile,'utf8')):{at:0,sources:{}},auditing=false;
const memo=new Map();
function plain(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();}
async function readRemote(url,max=4*1024*1024,headers={}){const {response}=await remote(url,headers);let n=0;const chunks=[];for await(const c of response){n+=c.length;if(n>max){response.destroy();throw Error('远程数据超过限制');}chunks.push(c);}return decodeBody(Buffer.concat(chunks),response.headers['content-encoding'],max).toString('utf8');}
async function jsonRemote(url){return JSON.parse(await readRemote(url,4*1024*1024,new URL(url).hostname==='api.bilibili.com'?{'User-Agent':'undici',Referer:'https://www.bilibili.com/'}:{}));}
async function cached(key,fn,ttl=3600000){const entry=memo.get(key);if(entry&&Date.now()-entry.at<ttl)return entry.value;const value=await fn();if(memo.size>150)memo.delete(memo.keys().next().value);memo.set(key,{value,at:Date.now()});return value;}
function absolute(data){if(Array.isArray(data))return data.map(absolute);if(data&&typeof data==='object')return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,absolute(v)]));return data;}
function send(req,res,data,type='application/json',status=200){if(res.destroyed)return;res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(absolute(data)):data);}
export async function auditSources(onlyFailed=false){
 if(auditing)return;auditing=true;let cursor=0;
 const candidates=onlyFailed?sources.filter(s=>!report.sources[s.id]?.enabled):sources;
 try{await Promise.all([0].map(async()=>{while(cursor<candidates.length){const source=candidates[cursor++];let found=false,errors=[];const started=Date.now();for(const title of ['鹿鼎记','阿凡达']){
  try{const list=await query(source,{ac:'videolist',wd:title});const movie=list.find(m=>m.episodes.length);if(!movie){errors.push('未返回可播放条目');continue;}await probeMedia(mediaSource(movie.episodes[0].url));found=true;break;}catch(e){errors.push(e.message);}
 }
 report.sources[source.id]={name:source.name,enabled:found,at:Date.now(),ms:Date.now()-started,mediaChecked:true,reason:found?'搜索、播放清单与首段读取通过':errors.join('；')};report.at=Date.now();fs.writeFileSync(healthFile+'.tmp',JSON.stringify(report,null,2));fs.renameSync(healthFile+'.tmp',healthFile);
 }}));}finally{auditing=false;}
}
async function probeMedia(url,depth=0){
 const {response,url:final}=await remote(url,{Range:'bytes=0-32767'});const type=String(response.headers['content-type']||'');
 if(/mpegurl/i.test(type)||/\.m3u8(?:\?|$)/i.test(final)){
  const chunks=[];let bytes=0;for await(const chunk of response){bytes+=chunk.length;if(bytes>2*1024*1024){response.destroy();throw Error('播放清单过大');}chunks.push(chunk);}const text=decodeBody(Buffer.concat(chunks),response.headers['content-encoding'],2*1024*1024).toString();
  if(!text.trimStart().startsWith('#EXTM3U'))throw Error('播放清单无效');const child=text.split(/\r?\n/).find(line=>line.trim()&&!line.startsWith('#'));if(!child||depth>2)throw Error('未找到媒体分段');return probeMedia(new URL(child.trim(),final).href,depth+1);
 }
 for await(const chunk of response){if(chunk.length){response.destroy();return;}}throw Error('媒体分段为空');
}
export function worksFromHtml(html){
 const titles=[];for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  for(const match of row[1].matchAll(/<a\b[^>]*title="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)){
   const title=plain(match[2]);if(!title||title.length<2||title.length>45||/^[\d\s年月日年代]+$/.test(title)||/^(列表不完整|编辑|編輯|中国|中國|香港|臺灣|台湾|美国|美國|日本|电影|電影|电视|電視|维基|維基)/.test(title))continue;
   if(!titles.includes(title))titles.push(title);break;
  }
 }
 return titles.slice(0,100);
}
async function actorWorks(name){return cached('actor:'+name,async()=>{
 const wiki='https://zh.wikipedia.org/w/api.php?',params={action:'parse',page:name,redirects:'1',prop:'wikitext',format:'json'};
 let d=await jsonRemote(wiki+new URLSearchParams(params));if(!d.parse)throw Error('未找到这个演员的资料，请使用完整姓名。');
 const text=d.parse.wikitext?.['*']||'';const section=text.match(/==\s*(?:影視作品|影视作品|演出作品|演出列表|電影作品|电影作品|作品列表|作品)\s*==([\s\S]*?)(?=\n==[^=]|$)/)?.[1];if(!section)throw Error('资料页没有演员作品列表，请使用片名搜索。');
 const linked=section.match(/\{\{(?:Main|main|主条目|主條目)\|([^}|]+(?:作品|电影|電影)[^}|]*)/);
 const page=linked?.[1]||d.parse.title;
 d=await jsonRemote(wiki+new URLSearchParams({...params,page,prop:'text',variant:'zh-cn'}));
 const html=d.parse?.text?.['*']||'';const titles=worksFromHtml(html);if(!titles.length)throw Error('资料页暂未找到作品列表，请试片名或另一种姓名写法。');
 return {name,works:titles,source:'https://zh.wikipedia.org/wiki/'+encodeURIComponent(page),attribution:'维基百科 · CC BY-SA'};
 },86400000);}
async function biliSearch(keyword){const d=await jsonRemote('https://api.bilibili.com/x/web-interface/search/type?'+new URLSearchParams({search_type:'video',keyword,page:'1'}));if(d.code!==0)throw Error('哔哩哔哩搜索暂不可用，可粘贴 BV 号匹配。');return {videos:(d.data?.result||[]).slice(0,15).map(v=>({bvid:v.bvid,title:plain(v.title),author:plain(v.author),duration:v.duration}))};}
async function biliParts(bvid){if(!/^BV[a-zA-Z0-9]{10}$/.test(bvid))throw Error('BV 号无效');const d=await jsonRemote('https://api.bilibili.com/x/web-interface/view?bvid='+bvid);if(d.code!==0)throw Error('视频信息不可用');return {title:d.data.title,parts:d.data.pages.map(p=>({cid:p.cid,title:p.part,page:p.page}))};}
function platforms(){return JSON.parse(fs.readFileSync(path.join(base,'platforms.json'),'utf8'));}
export const extensionServer=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(405);res.end();return;}
 const url=new URL(req.url,origin);
 try{
  if(url.pathname==='/api/extension')return send(req,res,{ok:true,version:3,mainUntouched:true});
  if(url.pathname==='/api/source-health')return send(req,res,{...report,auditing});
  if(url.pathname==='/api/source-health/recheck')return send(req,res,{error:'在线版暂不支持公开触发检测'},'application/json',405);
  if(req.method!=='GET')return send(req,res,{error:'不支持此操作'},'application/json',405);
  if(url.pathname==='/api/online/sources')return send(req,res,{sources:sources.filter(s=>report.sources[s.id]?.enabled!==false).map(({id,name})=>({id,name})),disabled:Object.values(report.sources).filter(s=>!s.enabled).length,checkedAt:report.at});
  if(url.pathname==='/api/actor')return send(req,res,await actorWorks((url.searchParams.get('q')||'').trim().slice(0,60)));
  if(url.pathname==='/api/platforms')return send(req,res,platforms());
  if(url.pathname==='/api/danmaku/search')return send(req,res,await cached('bili-search:'+url.search,()=>biliSearch((url.searchParams.get('q')||'').slice(0,100)),300000));
  if(url.pathname==='/api/danmaku/parts')return send(req,res,await cached('bili:'+url.search,()=>biliParts(url.searchParams.get('bvid')),3600000));
  if(url.pathname==='/api/danmaku/comments'){const cid=url.searchParams.get('cid');if(!/^\d{1,15}$/.test(cid||''))throw Error('弹幕分集标识无效');return send(req,res,await cached('xml:'+cid,()=>readRemote('https://comment.bilibili.com/'+cid+'.xml',8*1024*1024),3600000),'application/xml');}
  const files={'/':'online.html','/online':'online.html','/online.js':'online.js','/style.css':'style.css','/online.css':'online.css','/hls.min.js':'vendor/hls.min.js'};
  if(files[url.pathname]){const file=files[url.pathname];const type=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'application/javascript';return send(req,res,fs.readFileSync(path.join(base,'web',file),'utf8'),type);}
  if(await onlineRoute(req,res,url,send))return;
  send(req,res,{error:'接口不存在'},'application/json',404);
 }catch(e){send(req,res,{error:e.message},'application/json',502);}
});
if(process.argv.includes('--audit')){await auditSources();console.log('Source audit completed:',Object.values(report.sources).filter(s=>s.enabled).length,'enabled');}
else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))extensionServer.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Public cinema is ready'));
