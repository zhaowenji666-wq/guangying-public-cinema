// CMS episode parsing adapted from DecoTV src/lib/downstream.ts.
// Decohererk/DecoTV c02a9db, CC BY-NC-SA 4.0; see integrations/DecoTV/LICENSE.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {gunzipSync,inflateSync,inflateRawSync,brotliDecompressSync} from 'node:zlib';
const base=path.dirname(fileURLToPath(import.meta.url));
const configFile=path.join(base,'sources.json');
const customFile=path.join(base,'sources.custom.json');
// 片源列表支持热加载：修改 jin18.json 或 sources.custom.json 后约 5 秒内自动生效，无需重启。
export let sources=[];
let sourceStamp='';
function loadSources(){
 try{
  const merged=JSON.parse(fs.readFileSync(configFile,'utf8')).api_site;
  if(fs.existsSync(customFile)){
   try{Object.assign(merged,JSON.parse(fs.readFileSync(customFile,'utf8')).api_site||{});}
   catch(e){process.stderr.write('sources.custom.json 无效，已忽略：'+e.message+'\n');}
  }
  sources=Object.entries(merged).map(([id,s])=>({id,name:s.name,api:s.api}));
 }catch(e){process.stderr.write('片源配置读取失败：'+e.message+'\n');}
}
loadSources();
const sourceWatcher=setInterval(()=>{
 try{
  const stamp=[configFile,customFile].map(f=>{try{return fs.statSync(f).mtimeMs;}catch{return 0;}}).join('|');
  if(stamp!==sourceStamp){sourceStamp=stamp;loadSources();}
 }catch{}
},5000);
sourceWatcher.unref();
const tokens=new Map(),tokenUrls=new Map(),cache=new Map();
const plain=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
export function publicAddress(address){
 if(net.isIPv4(address)){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224||a===198&&(b===18||b===19));}
 // Only global unicast IPv6; reject mapped IPv4, loopback, link-local and ULA.
 return net.isIPv6(address)&&/^[23][0-9a-f]{0,3}:/i.test(address);
}
export function safeUrl(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('无效的远程地址');return u;}
export async function remote(value,headers={},redirects=0){
 const u=safeUrl(value),host=u.hostname.replace(/^\[|\]$/g,'');
 const addresses=await dns.lookup(host,{all:true});
 // This PC's TUN DNS returns 198.18/15 synthetic addresses for public hostnames.
 // Permit only DNS-produced fake IPs; literal private/reserved URL hosts stay blocked.
 const fakeIP=a=>process.env.CINEMA_TEST_FAKE_IP==='1'&&!net.isIP(host)&&/^198\.(18|19)\./.test(a.address);
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)&&!fakeIP(a))||net.isIP(host)&&!publicAddress(host))throw Error('不允许访问内网地址');
 const pinned=addresses[0];
 const response=await new Promise((resolve,reject)=>{
  const request=(u.protocol==='https:'?https:http).get(u,{headers:{'User-Agent':'Mozilla/5.0',...headers},lookup:(_h,opts,cb)=>opts.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family)},resolve);
  request.setTimeout(12000,()=>request.destroy(Error('片源连接超时')));request.once('error',reject);
 });
 if([301,302,303,307,308].includes(response.statusCode)){response.resume();if(redirects>=4)throw Error('重定向过多');return remote(new URL(response.headers.location,u).href,headers,redirects+1);}
 if(response.statusCode<200||response.statusCode>=300){response.resume();throw Error('片源返回 '+response.statusCode);}
 return {response,url:u.href};
}
export function decodeBody(bytes,encoding,max){if(encoding==='deflate'){try{return inflateSync(bytes,{maxOutputLength:max});}catch(error){if(error.code==='ERR_BUFFER_TOO_LARGE')throw error;return inflateRawSync(bytes,{maxOutputLength:max});}}const decode={gzip:gunzipSync,br:brotliDecompressSync}[encoding];return decode?decode(bytes,{maxOutputLength:max}):bytes;}
async function body(response,max){const chunks=[];let size=0;for await(const chunk of response){size+=chunk.length;if(size>max){response.destroy();throw Error('片源响应过大');}chunks.push(chunk);}return decodeBody(Buffer.concat(chunks),response.headers['content-encoding'],max);}
export function register(url){
 try{safeUrl(url);}catch{return '';}
 const existing=tokenUrls.get(url);if(existing&&tokens.has(existing)){tokens.get(existing).at=Date.now();return '/online/media/'+existing;}
 const remove=key=>{const value=tokens.get(key);if(value)tokenUrls.delete(value.url);tokens.delete(key);};
 if(tokens.size>12000){const now=Date.now();for(const [key,v] of tokens)if(now-v.at>6*3600000)remove(key);if(tokens.size>12000)remove(tokens.keys().next().value);}
 const key=randomBytes(18).toString('hex');tokens.set(key,{url,at:Date.now()});tokenUrls.set(url,key);return '/online/media/'+key;
}
export function mediaSource(tokenPath){return tokens.get(String(tokenPath).split('/').pop())?.url;}
export function parseEpisodes(value){
 let episodes=[];
 for(const group of String(value||'').split('$$$')){
  const entries=group.split('#').flatMap(entry=>{const split=entry.indexOf('$');if(split<0)return [];const title=plain(entry.slice(0,split)),url=entry.slice(split+1).trim();try{safeUrl(url);return [{title:title||'正片',url}];}catch{return [];}});
  if(entries.length>episodes.length)episodes=entries;
 }
 return episodes;
}
function result(item,source){return {id:String(item.vod_id),title:plain(item.vod_name),actors:plain(item.vod_actor),director:plain(item.vod_director),genre:plain(item.vod_class||item.type_name),type:plain(item.type_name),year:plain(item.vod_year).match(/\d{4}/)?.[0]||'',poster:register(item.vod_pic),remarks:plain(item.vod_remarks),description:plain(item.vod_content).slice(0,3000),source:source.id,sourceName:source.name,episodes:parseEpisodes(item.vod_play_url).map(e=>({title:e.title,url:register(e.url),hls:! /\.(mp4|webm|mkv)(?:[?#]|$)/i.test(e.url)}))};}
export async function query(source,params){
 const u=new URL(source.api);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 const {response}=await remote(u.href);const data=JSON.parse((await body(response,8*1024*1024)).toString());
 if(!Array.isArray(data.list))throw Error('片源未返回影片列表');
 const normalized=s=>plain(s).toLowerCase().replace(/\s/g,'');
 return data.list.filter(m=>m.vod_id&&m.vod_name&&!/成人版|伦理片|色情|情色|AV女优/.test(m.vod_name+' '+(m.type_name||''))&&(!params.wd||normalized([m.vod_name,m.vod_actor,m.vod_director].filter(Boolean).join(' ')).includes(normalized(params.wd)))).slice(0,60).map(m=>result(m,source));
}
export function rewritePlaylist(text,baseUrl){
 return text.split(/\r?\n/).map(line=>{
  if(!line.trim())return line;
  if(line.startsWith('#'))return line.replace(/URI="([^"]+)"/g,(_,value)=>'URI="'+register(new URL(value,baseUrl).href)+'"');
  return register(new URL(line.trim(),baseUrl).href);
 }).join('\n');
}
export async function onlineRoute(req,res,url,send){
 if(url.pathname==='/api/online/sources'){send(req,res,{sources:sources.map(({id,name})=>({id,name})),project:'LunaTV-config + DecoTV',variant:'jin18+custom'});return true;}
 if(['/api/online/search','/api/online/detail'].includes(url.pathname)){
  const source=sources.find(s=>s.id===url.searchParams.get('source'));if(!source){send(req,res,{error:'片源不存在'},'application/json',400);return true;}
  const detail=url.pathname.endsWith('/detail'),q=(url.searchParams.get(detail?'id':'q')||'').trim().slice(0,120);
  if(!q){send(req,res,{error:'请输入片名'},'application/json',400);return true;}
  const key=JSON.stringify([source.id,detail,q]);let value=cache.get(key);
  try{if(!value||Date.now()-value.at>600000){let results=await query(source,detail?{ac:'detail',ids:q}:{ac:'videolist',wd:q});if(detail&&!results.some(m=>m.episodes.length))results=await query(source,{ac:'videolist',ids:q});value={at:Date.now(),results};if(cache.size>300)cache.delete(cache.keys().next().value);cache.set(key,value);}send(req,res,{results:value.results});}catch(e){send(req,res,{error:e.message,results:[]},'application/json',502);}return true;
 }
 if(url.pathname.startsWith('/online/media/')){
  const record=tokens.get(url.pathname.split('/').pop());
  if(!record||Date.now()-record.at>6*3600000){send(req,res,{error:'播放链接已过期，请重新搜索'},'application/json',410);return true;}
  try{
   const headers={};if(req.headers.range&&/^bytes=\d*-\d*$/.test(req.headers.range))headers.Range=req.headers.range;
   const {response,url:finalUrl}=await remote(record.url,headers);
   res.once('close',()=>response.destroy());
   const type=String(response.headers['content-type']||'');
   if(/mpegurl/i.test(type)||/\.m3u8(?:\?|$)/i.test(finalUrl)){
    const text=(await body(response,2*1024*1024)).toString();if(!text.trimStart().startsWith('#EXTM3U'))throw Error('播放列表格式无效');
    send(req,res,rewritePlaylist(text,finalUrl),'application/vnd.apple.mpegurl');
   }else{
    const out={'Content-Type':/^(image|video|audio)\//.test(type)?type:'application/octet-stream','Cache-Control':'private, max-age=120','X-Content-Type-Options':'nosniff'};
    for(const key of ['content-length','content-range','accept-ranges'])if(response.headers[key])out[key]=response.headers[key];
    res.writeHead(response.statusCode,out);response.on('error',()=>res.destroy());response.pipe(res);
   }
  }catch(e){if(!res.headersSent)send(req,res,{error:e.message},'application/json',502);else res.destroy();}
  return true;
 }
 return false;
}
