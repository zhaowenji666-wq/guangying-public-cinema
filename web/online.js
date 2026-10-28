const CINEMA_BUILD='20261028183938231';
const movieKey=m=>m.source+':'+m.id;
function mediaKind(m){
 const type=String(m.type||''), text=type+' '+String(m.remarks||'');
 if(/电视剧|连续剧|剧集|国产剧|港剧|香港剧|港台剧|港澳剧|台剧|台湾剧|美剧|韩剧|日剧|海外剧|欧美剧|动漫剧|第\s*[\d一二三四五六七八九十百]+\s*集|\d+\s*集全/.test(text))return 'series';
 if(/电影|影片|(?:动作|喜剧|剧情|爱情|科幻|恐怖|战争|动画|悬疑|惊悚|犯罪|奇幻|冒险|武侠|纪录)片|正片|HD|BD|蓝光|高清/i.test(text))return 'film';
 if((m.episodes?.length||m.episodeCount||0)>1)return 'series';
 return 'unknown';
}
function normalizedTitle(m){
 let title=String(m.title||'').normalize('NFKC').toLowerCase().replace(/[記龍國語]/g,c=>({記:'记',龍:'龙',國:'国',語:'语'}[c])).replace(/ii/g,'2').replace(/[\s·•:：\-—_]/g,'');
 const actor=String(m.actors||'').split(/[,，、/]/)[0].trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(let i=0;i<3;i++){
  title=title.replace(/[（(\[](?:(?:国|粤|国粤)|[^\[\]（）()]{1,14}(?:语|版))[）)\]]$/,'');
  title=title.replace(/(?:国语|粤语|普通话|国粤双语|完整版|高清版|修复版|导演剪辑版)$/,'');
  title=title.replace(/[（(](?:国|粤)[）)]$/,'');
  if(actor)title=title.replace(new RegExp(actor+'(?:版)?$'), '');
  title=title.replace(/[\u4e00-\u9fff]{2,4}版$/,'');
  if(m.year)title=title.replace(new RegExp(String(m.year).slice(-2)+'版$'),'');
  title=title.replace(/(?:19|20)\d{2}$/,'');
 }
 if(title.length%2===0&&title.slice(0,title.length/2)===title.slice(title.length/2))title=title.slice(0,title.length/2);
 return title;
}
const canonicalYear=m=>String(m.title||'').match(/(?:19|20)\d{2}/g)?.at(-1)||String(m.year||'');
const filmKey=m=>normalizedTitle(m)+'|'+canonicalYear(m)+'|'+mediaKind(m);
function resumePoint(saved,episodes){
 if(!saved||!episodes.length)return {index:0,time:0};
 const byTitle=typeof saved.episodeTitle==='string'?episodes.findIndex(e=>e.title===saved.episodeTitle):-1;
 const index=byTitle>=0?byTitle:Math.min(Math.max(0,Math.floor(Number(saved.episode)||0)),episodes.length-1);
 const time=Number(saved.time);return {index,time:Number.isFinite(time)?Math.max(0,time):0};
}
function playbackTransfer(target,live){
 if(live?.readyState>=1&&Number.isFinite(live.time)&&live.time>=0&&(live.readyState>=2||live.time>0))return {...target,time:live.time};
 return {...target,time:Math.max(0,Number(target?.time)||0)};
}
function removeGroupEntries(store,group){
 const removed={};for(const movie of group){const id=movieKey(movie);if(Object.hasOwn(store,id)){removed[id]=store[id];delete store[id];}}
 return removed;
}
function subtitleToVtt(input,offset=0){
 const shift=Math.max(-3600,Math.min(3600,Number(offset)||0));
 const seconds=value=>value.replace(',','.').split(':').reduce((sum,n)=>sum*60+Number(n),0);
 const stamp=value=>{const ms=Math.round(Math.max(0,value)*1000);return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');};
 const cues=[];const timing=/^\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3})(.*)$/;
 for(const block of String(input).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n\s*\n/)){
  const lines=block.split('\n'),index=lines.findIndex(line=>timing.test(line));if(index<0)continue;
  const match=lines[index].match(timing),start=seconds(match[1])+shift,end=seconds(match[2])+shift,text=lines.slice(index+1).join('\n').trim();
  if(!text||end<=Math.max(0,start))continue;
  cues.push(stamp(start)+' --> '+stamp(end)+match[3]+'\n'+text);
 }
 if(!cues.length)throw Error('没有找到可用字幕，请选择有效的 SRT 或 VTT 文件。');
 return 'WEBVTT\n\n'+cues.join('\n\n')+'\n';
}
function groupMovies(results,{query='',year='',source='',sort='relevance',hideExtras=false,text='',genre='',kind=''}={}){
 const groups=new Map();
 const terms=String(text).toLowerCase().trim().split(/\s+/).filter(Boolean);
 for(const m of results){
  if(kind&&mediaKind(m)!==kind||year&&String(m.year)!==year||source&&m.source!==source||hideExtras&&/解说|预告|制作特辑|幕后/.test(m.title))continue;
  const fields=[m.title,m.year,m.actors,m.director,m.genre,m.sourceName].filter(Boolean).join(' ').toLowerCase();
  if(terms.some(term=>!fields.includes(term))||genre&&!onlineGenres(m.genre).includes(genre))continue;
  const id=filmKey(m);if(!groups.has(id))groups.set(id,[]);
  if(!groups.get(id).some(x=>movieKey(x)===movieKey(m)))groups.get(id).push(m);
 }
 const normalize=s=>s.toLowerCase().replace(/\s/g,'');const q=normalize(query);
 const score=m=>normalize(m.title)===q?0:normalize(m.title).startsWith(q)?1:2;
 return [...groups.values()].sort((a,b)=>{
  const order={film:0,series:1,unknown:2}, kindOrder=order[mediaKind(a[0])]-order[mediaKind(b[0])];if(kindOrder)return kindOrder;
  if(sort==='year-desc'||sort==='year-asc'){const ay=Number(a[0].year)||0,by=Number(b[0].year)||0;if(!ay||!by)return ay? -1:by?1:0;if(ay!==by)return sort==='year-desc'?by-ay:ay-by;}
  if(sort==='sources'&&a.length!==b.length)return b.length-a.length;
  if(sort==='recent')return (Number(b[0].at)||0)-(Number(a[0].at)||0);
  if(sort==='relevance'&&query&&score(a[0])!==score(b[0]))return score(a[0])-score(b[0]);
  return a[0].title.localeCompare(b[0].title,'zh-CN');
 });
}
function onlineGenres(value){return [...new Set(String(value||'').split(/[,，、\/|;；]+/).map(s=>s.trim().replace(/^(动作|喜剧|剧情|爱情|科幻|恐怖|战争|动画|悬疑|惊悚|犯罪|奇幻|冒险|武侠)片$/,'$1')).filter(Boolean))];}
function episodeResume(progress){
 const time=Number(progress?.time),duration=Number(progress?.duration);
 if(!Number.isFinite(time)||time<0)return 0;
 return episodeDone(progress)?0:time;
}
function episodeDone(progress){const time=Number(progress?.time),duration=Number(progress?.duration);return Number.isFinite(time)&&Number.isFinite(duration)&&time>0&&duration>0&&time>=Math.max(duration*.98,duration-8);}
function recordEpisode(previous,movie,{episode,title,time,duration,at}){
 const progress={...(previous?.episodeProgress||{}),[episode]:{title,time,duration,at}};
 const episodeProgress=Object.fromEntries(Object.entries(progress).sort((a,b)=>b[1].at-a[1].at).slice(0,200));
 return {...movie,episode,episodeTitle:title,time,duration,at,episodeProgress};
}
function mergeEpisodeHistory(existing,incoming){
 if(!existing)return incoming;
 const newer=(Number(incoming.at)||0)>(Number(existing.at)||0)?incoming:existing;
 const older=newer===incoming?existing:incoming,progress={};
 for(const row of [existing,incoming]){
  const entries={...(row.episodeProgress||{})};
  if(Number.isInteger(row.episode)&&Number.isFinite(row.time)&&row.time>0&&!entries[row.episode])entries[row.episode]={title:row.episodeTitle||'',time:row.time,duration:Number(row.duration)||0,at:Number(row.at)||0};
  for(const [index,value] of Object.entries(entries))if(!progress[index]||value.at>progress[index].at)progress[index]=value;
 }
 return {...older,...newer,episodeProgress:Object.fromEntries(Object.entries(progress).sort((a,b)=>b[1].at-a[1].at).slice(0,200))};
}
function validateBackup(data){
 if(data?.app!=='cinema-online'||data.version!==1)throw Error('请选择光影在线影视导出的备份文件。');
 const clean={favorites:{},history:{},shelves:{}};
 for(const field of Object.keys(clean)){
  const entries=data[field];if(!entries||typeof entries!=='object'||Array.isArray(entries))throw Error('备份格式不完整。');
  if(Object.keys(entries).length>3000)throw Error('备份条目过多。');
  for(const [id,m] of Object.entries(entries)){
   if(!m||typeof m!=='object'||typeof m.id!=='string'||typeof m.source!=='string'||typeof m.title!=='string'||id!==movieKey(m)||['__proto__','constructor','prototype'].includes(id))throw Error('备份包含无效影片。');
   const item={id:m.id.slice(0,120),source:m.source.slice(0,200),title:m.title.slice(0,300),sourceName:String(m.sourceName||'').slice(0,200),year:String(m.year||'').slice(0,8),remarks:String(m.remarks||'').slice(0,100),poster:/^(?:http:\/\/(?:127\.0\.0\.1|localhost):18766)?\/online\/media\/[a-f0-9]{36}$/.test(m.poster||'')?m.poster:'',at:Math.max(0,Number(m.at)||0)};
   for(const field of ['actors','director','genre','type'])if(typeof m[field]==='string')item[field]=m[field].slice(0,600);if(Number.isFinite(m.episodeCount))item.episodeCount=Math.max(0,Math.min(10000,Math.floor(m.episodeCount)));
   if(!Number.isFinite(item.at)||m.id.length>120||m.source.length>200)throw Error('备份包含无效影片标识或时间。');
   if(field==='history'){item.episode=Math.max(0,Math.floor(Number(m.episode)||0));item.episodeTitle=String(m.episodeTitle||'').slice(0,150);item.time=Math.max(0,Number(m.time)||0);item.duration=Math.max(0,Number(m.duration)||0);if(!Number.isFinite(item.episode)||!Number.isFinite(item.time)||!Number.isFinite(item.duration))throw Error('备份包含无效进度。');}
   if(field==='history'&&m.episodeProgress!==undefined){
    if(!m.episodeProgress||typeof m.episodeProgress!=='object'||Array.isArray(m.episodeProgress)||Object.keys(m.episodeProgress).length>200)throw Error('每集进度格式无效。');
    item.episodeProgress={};for(const [index,p] of Object.entries(m.episodeProgress)){
     if(!/^\d{1,6}$/.test(index)||!p||typeof p!=='object'||[p.time,p.duration,p.at].some(v=>!Number.isFinite(v)||v<0))throw Error('备份包含无效的每集进度。');
     item.episodeProgress[index]={title:String(p.title||'').slice(0,150),time:p.time,duration:p.duration,at:p.at};
    }
   }
   if(field==='shelves'){if(!['watchlist','watched'].includes(m.status))throw Error('备份影片状态无效。');item.status=m.status;}
   clean[field][id]=item;
  }
 }
 return clean;
}
function normalizeDanmaku(input){
 const rows=Array.isArray(input)?input:input?.comments||input?.data||[];
 if(!Array.isArray(rows))throw Error('弹幕需要 JSON 数组或 comments 数组。');
 const seen=new Set(),items=[];
 for(const row of rows.slice(0,50000)){
  if(!row||typeof row!=='object')continue;const p=String(row.p||'').split(',');
  const time=Number(row.time??p[0]),text=String(row.text??row.m??'').trim().slice(0,200),mode=Number(row.mode??p[1])||1;
  if(!Number.isFinite(time)||time<0||!text)continue;const id=time.toFixed(1)+':'+text;if(seen.has(id))continue;seen.add(id);
  let color=row.color??p[2]??16777215;if(typeof color==='string'&&/^#[a-f0-9]{6}$/i.test(color))color=color;else{const number=Number(color);color='#'+(Number.isFinite(number)?Math.max(0,Math.min(16777215,Math.floor(number))):16777215).toString(16).padStart(6,'0');}
  items.push({time,text,color,mode:[4,5].includes(mode)?mode:1});
 }
 return items.sort((a,b)=>a.time-b.time);
}
function danmakuStart(items,time){let lo=0,hi=items.length;while(lo<hi){const mid=(lo+hi)>>>1;if(items[mid].time<time)lo=mid+1;else hi=mid;}return lo;}
function sourceFailureLabel(reason){
 return [...new Set(String(reason||'').split('；').map(s=>/Unexpected token|JSON|DOCTYPE|未返回影片列表/.test(s)?'线路数据异常':/403/.test(s)?'线路暂不可用':/404/.test(s)?'该线路已失效':/超时|timeout/i.test(s)?'连接超时':s))].join('；');
}

const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const EXT_ORIGIN='';
function stored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
let sources=[],selected=stored('cinema-online-sources',null),results=[],cards=[],searchVersion=0,controllers=[],current=null,requestedMovie=null,episode=0,hls=null,playVersion=0,view='search';
let favorites=stored('cinema-online-favorites',{}),history=stored('cinema-online-history',{});
let shelves=stored('cinema-online-shelves',{}),health=stored('cinema-online-health',{}),recent=stored('cinema-online-recent',[]),preferences=stored('cinema-online-preferences',{}),failedSources=[],activeGroup=[],lastQuery='',searching=false,undoBackup=null,episodeReversed=false,cardUndo=null;
let visibleLimit=48,searchSnapshot=null,pendingPlayback=null,searchAt=0,probeVersion=0,triedSources=new Set(),stallTimer=null,failoverRunning=false,selectionHint='',currentQuality='自动画质';
let qualityMemory=stored('cinema-source-quality-memory',{});
let doubanMatches=[];
const key=movieKey;
const status=message=>$('#online-status').textContent=message;
const playerStatus=message=>$('#online-player-status').textContent=message;
const sourceRank=m=>/极速资源/.test(m.sourceName)?0:/速播|光速/.test(m.sourceName)?1:/360|无尽/.test(m.sourceName)?2:3;
const qualityLabel=height=>height>=2160?'4K':height>=1440?'2K':height>=1080?'1080P':height>=720?'720P':height?'高清':'标清';
const qualityTargetLabel=height=>height>=2160?'4K':height>=1440?'2K':height>=1080?'1080P':height>=720?'720P':'更清晰';
// 选源过程的用户文案只谈「画质/流畅」：多少毫秒、哪家片源属于实现细节，不暴露给用户。
const sourceChoiceHint=(probe,target=0)=>target&&probe.height&&probe.height<target?qualityLabel(probe.height):qualityLabel(probe.height);
const inferredQuality=movie=>{const text=[movie?.title,movie?.remarks,movie?.genre].filter(Boolean).join(' ');return /(?:2160p?|4k|超高清)/i.test(text)?2160:/(?:1440p?|2k)/i.test(text)?1440:/1080p?/i.test(text)?1080:/720p?/i.test(text)?720:0;};
const speedQualityLimit=rate=>rate>=3.5?720:rate>=2.5?1080:Infinity;
const blockedSources=new Set(['slapibf.com','fhapi9.com']),unsafeContent=/成人|伦理|情色|色情|无码|有码|成人视频|AV女优|福利姬|写真|里番|三级(?:片|电影)|限制级/i;
const safeMovie=movie=>movie&&!blockedSources.has(movie.source)&&!unsafeContent.test([movie.title,movie.type,movie.genre,movie.remarks].filter(Boolean).join(' '));
for(const store of [favorites,history,shelves])for(const [id,movie] of Object.entries(store))if(!safeMovie(movie))delete store[id];
async function api(route,params={}){let response;try{response=await fetch(EXT_ORIGIN+route+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(25000)});}catch(error){if(!route.startsWith('/api/online/'))throw error;response=await fetch(route+'?'+new URLSearchParams(params));}const data=await response.json();if(!response.ok)throw Error(data.error||'连接失败');return data;}
function doubanFor(movie){const title=normalizedTitle(movie),year=canonicalYear(movie);return doubanMatches.find(row=>normalizedTitle(row)===title&&(!year||!row.year||year===String(row.year))&&(row.kind===mediaKind(movie)||mediaKind(movie)==='unknown'));}
async function loadDoubanRatings(q,version){try{const data=await api('/api/douban',{q});if(version!==searchVersion)return;doubanMatches=data.results||[];render();}catch{if(version===searchVersion)doubanMatches=[];}}
async function loadDoubanHot(type='movie'){
 const box=$('#douban-grid'),statusBox=$('#douban-status');statusBox.textContent='正在读取近期热门…';
 try{const data=await api('/api/douban',{type});box.innerHTML=data.results.map(row=>`<button class="douban-item" data-douban-title="${esc(row.title)}"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(row.poster)}" alt="${esc(row.title)}海报"><span>${esc(row.title)}</span><small>${esc(row.year||'年份未知')}</small>${row.rating?`<b class="douban-score">${row.rating.toFixed(1)}</b>`:''}</button>`).join('');statusBox.textContent=`${data.results.length} 部近期热门，点开就能播放。`;box.querySelectorAll('img').forEach(img=>img.onerror=()=>img.remove());}
 catch{box.replaceChildren();statusBox.textContent='豆瓣热门暂时无法读取，稍后刷新即可重试。';}
}
function save(){try{localStorage.setItem('cinema-online-favorites',JSON.stringify(favorites));localStorage.setItem('cinema-online-history',JSON.stringify(history));localStorage.setItem('cinema-online-shelves',JSON.stringify(shelves));updateCounts();}catch{playerStatus('本机存储空间不足，观看进度未能保存。');}}
save();
function metadata(m){const {id,title,year,poster,remarks,source,sourceName,actors,director,genre,type}=m;return {id,title,year,poster,remarks,source,sourceName,actors,director,genre,type,episodeCount:m.episodes?.length||m.episodeCount||0};}
function render(){
 const oldYear=$('#online-year').value,oldSource=$('#online-source-filter').value,oldGenre=$('#online-genre').value;
 const genres=[...new Set(results.flatMap(m=>onlineGenres(m.genre)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));$('#online-genre').innerHTML='<option value="">全部类型</option>'+genres.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join('');$('#online-genre').value=genres.includes(oldGenre)?oldGenre:'';
 const years=[...new Set(results.map(m=>m.year).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));
 $('#online-year').innerHTML='<option value="">全部年份</option>'+years.map(y=>`<option value="${esc(y)}">${esc(y)}</option>`).join('');$('#online-year').value=years.includes(oldYear)?oldYear:'';
 const present=[...new Map(results.map(m=>[m.source,{id:m.source,name:m.sourceName||m.source}])).values()];$('#online-source-filter').innerHTML='<option value="">全部线路</option>'+present.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');$('#online-source-filter').value=present.some(s=>s.id===oldSource)?oldSource:'';
 cards=groupMovies(results,{query:lastQuery,year:$('#online-year').value,source:$('#online-source-filter').value,sort:$('#online-sort').value,hideExtras:$('#hide-extras').checked,text:$('#result-search').value,genre:$('#online-genre').value,kind:$('#online-kind').value});
 $('#online-result-count').textContent=`${cards.length} 部影片 · 显示 ${Math.min(visibleLimit,cards.length)} 部`;$('#online-more').hidden=cards.length<=visibleLimit;$('#online-more').textContent='再显示 48 部（剩余 '+Math.max(0,cards.length-visibleLimit)+' 部）';
 $('#online-empty').hidden=cards.length>0||searching;$('#online-empty').textContent=results.length?'没有符合筛选的影片，可清除筛选后查看。':'搜索片名开始探索，也可以从左侧打开待看、收藏和续播。';
 $('#online-grid').innerHTML=cards.slice(0,visibleLimit).map((group,i)=>{const m=group[0],kind=mediaKind(m),previous=i?mediaKind(cards[i-1][0]):null,heading=kind!==previous?`<h3 class="result-kind">${({film:'电影',series:'电视剧',unknown:'其他 / 未分类'})[kind]}</h3>`:'',record=group.map(m=>history[key(m)]).filter(Boolean).sort((a,b)=>b.at-a.at)[0],shelf=group.map(m=>shelves[key(m)]).filter(Boolean).sort((a,b)=>b.at-a.at)[0];const percent=record?.duration?Math.min(100,record.time/record.duration*100):0;const removable=view!=='search';return `${heading}<article class="online-card"><button class="online-card-open" data-card="${i}" aria-label="播放 ${esc(m.title)}"><div class="online-cover"><span>${esc(m.title)}</span>${m.poster?`<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(m.poster)}" alt="${esc(m.title)}海报">`:''}${shelf?`<b class="shelf-badge">${shelf.status==='watched'?'✓ 已看完':'＋ 待看'}</b>`:''}</div><div class="online-card-info"><h3>${esc(m.title)}</h3><p>${esc(m.year||'年份未知')} · ${esc(m.remarks||'在线播放')}</p><p>${group.length>1?'可播放 · '+group.length+' 个画质来源':esc(m.remarks||'在线播放')}</p>${record?`<p>续播 · ${esc(record.episodeTitle||'第 '+(record.episode+1)+' 集')} · ${Math.floor(record.time/60)} 分钟</p><div class="watch-progress" style="--progress:${percent}%"></div>`:''}</div></button><div class="quick-actions"><button data-quick="favorite" data-index="${i}" aria-pressed="${group.some(x=>!!favorites[key(x)])}" aria-label="收藏 ${esc(m.title)}">${group.some(x=>!!favorites[key(x)])?'♥ 已收藏':'♡ 收藏'}</button><button data-quick="watchlist" data-index="${i}" aria-pressed="${group.some(x=>shelves[key(x)]?.status==='watchlist')}" aria-label="待看 ${esc(m.title)}">${group.some(x=>shelves[key(x)]?.status==='watchlist')?'✓ 已待看':'＋ 待看'}</button></div>${removable?`<button class="card-remove" data-remove="${i}" aria-label="移除该影片的播放记录" title="移除该影片的播放记录">✕</button>`:''}</article>`;}).join('');
 $('#online-grid').querySelectorAll('.online-card').forEach((card,i)=>{const match=doubanFor(cards[i]?.[0]);if(match?.rating)card.querySelector('h3')?.insertAdjacentHTML('beforeend',`<span class="douban-rating">豆瓣 ${match.rating.toFixed(1)}</span>`);});
 $('#online-grid').querySelectorAll('img').forEach(img=>img.onerror=()=>img.remove());
}
function cancelSearch(){searchVersion++;controllers.forEach(c=>c.abort());controllers=[];searching=false;$('#cancel-search').hidden=true;}
async function search(retry=false){
 const q=$('#query').value.trim();if(!q)return;
 retry=retry&&q===lastQuery;
 const retryIds=[...failedSources];cancelSearch();const version=searchVersion;searching=true;view='search';lastQuery=q;if(!retry){searchAt=Date.now();visibleLimit=48;results=[];doubanMatches=[];$('#source-progress').replaceChildren();clearFilters();loadDoubanRatings(q,version);}failedSources=[];render();$('#online-title').textContent='搜索：'+q;$('#cancel-search').hidden=false;$('#retry-failed').hidden=true;
 recent=[q,...recent.filter(x=>x!==q)].slice(0,8);localStorage.setItem('cinema-online-recent',JSON.stringify(recent));renderRecent();updateCounts();
 $('#actor-panel').hidden=true;
 if($('#search-kind').value==='actor'){await showActorWorks(q,version,true);if(version!==searchVersion)return;searching=false;$('#cancel-search').hidden=true;render();return;}
 if($('#search-kind').value==='auto')showActorWorks(q,version,false);
 // 排序权重：0=上次成功且够快，1=成功但慢（>4s），2=上次失败。
 // 先跑又快又稳的源，用户能更早看到第一批结果。
 const weight=s=>{const h=health[s.id];if(!h)return 0;if(h.failed)return 2;return (h.ms||5000)>4000?1:0;};
 const queue=sources.filter(s=>selected.includes(s.id)&&(!retry||retryIds.includes(s.id))).sort((a,b)=>weight(a)-weight(b)||(health[a.id]?.ms||5000)-(health[b.id]?.ms||5000));let next=0,finished=0,failed=0;
 if(!queue.length){searching=false;status('还没有可用的播放线路，请稍后再试。');$('#cancel-search').hidden=true;render();return;}
 status('正在搜索，结果将陆续显示…');
 async function worker(){while(next<queue.length&&version===searchVersion){
  const source=queue[next++],controller=new AbortController(),started=performance.now();controllers.push(controller);
  const tag=document.createElement('span');tag.textContent=source.name+' · 搜索中';$('#source-progress').append(tag);
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const r=await fetch(EXT_ORIGIN+'/api/online/search?'+new URLSearchParams({source:source.id,q}),{signal:controller.signal}),d=await r.json();
   if(version!==searchVersion)return;if(!r.ok)throw Error(d.error);
   const incoming=new Set(d.results.map(key));results=results.filter(m=>!incoming.has(key(m)));results.push(...d.results);{const ms=Math.round(performance.now()-started),prev=health[source.id]?.ms;health[source.id]={ms:prev?Math.round(prev*0.6+ms*0.4):ms,failed:false};}tag.textContent=source.name+' · '+d.results.length;render();
  }catch{if(version!==searchVersion)return;failed++;failedSources.push(source.id);health[source.id]={ms:health[source.id]?.ms||5000,failed:true};tag.classList.add('failed');tag.textContent=source.name+' · 暂不可用';}
  finally{clearTimeout(timeout);controllers=controllers.filter(c=>c!==controller);}
  finished++;status(`已完成 ${finished}/${queue.length} 条线路 · ${cards.length} 部影片${failed?' · '+failed+' 条暂时繁忙':''}`);
 }}
 await Promise.all(Array.from({length:Math.min(14,queue.length)},worker));
 if(version!==searchVersion)return;searching=false;$('#cancel-search').hidden=true;$('#retry-failed').hidden=!failedSources.length;localStorage.setItem('cinema-online-health',JSON.stringify(health));render();
 if(!results.length)status(`没有找到这部影片，试试换个片名或换个说法。`);rememberSearch();
}
function episodePosition(index){const saved=current?history[key(current)]:null;return episodeResume(saved?.episodeProgress?.[index]||(saved?.episode===index?saved:null));}
function renderEpisodes(){
 const query=$('#episode-query').value.trim().toLowerCase();let entries=current.episodes.map((e,i)=>({...e,index:i})).filter(e=>e.title.toLowerCase().includes(query));if(episodeReversed)entries.reverse();
 $('#episodes').innerHTML=entries.map(e=>`<button data-episode="${e.index}" class="${e.index===episode?'selected':''}" ${e.index===episode?'aria-current="true"':''}>${esc(e.title)}${history[key(current)]?.episodeProgress?.[e.index]?`<small>${episodeDone(history[key(current)].episodeProgress[e.index])?'已看完':'已看 '+formatTime(history[key(current)].episodeProgress[e.index].time)}</small>`:''}</button>`).join('')||'<p>没有符合的剧集。</p>';
 $('#online-next').disabled=episode>=current.episodes.length-1;
 $('#online-prev').disabled=episode===0;
 $('#online-favorite').textContent=favorites[key(current)]?'♥ 已收藏':'♡ 收藏';
 $('#online-watchlist').textContent=shelves[key(current)]?.status==='watchlist'?'✓ 已加入待看':'＋ 待看';
 $('#online-watched').textContent=shelves[key(current)]?.status==='watched'?'✓ 已看完':'标记已看完';
}
function remember(){if(!current)return;const video=$('#online-video');if(video.readyState>=1&&video.currentTime>1){history[key(current)]=recordEpisode(history[key(current)],metadata(current),{episode,title:current.episodes[episode]?.title||'',time:video.currentTime,duration:Number.isFinite(video.duration)?video.duration:0,at:Date.now()});const ordered=Object.entries(history).sort((a,b)=>b[1].at-a[1].at);history=Object.fromEntries(ordered.slice(0,150));save();}}
function stop(){clearTimeout(stallTimer);remember();playVersion++;const video=$('#online-video');video.pause();if(hls){hls.destroy();hls=null;}video.removeAttribute('src');video.load();}
async function openMovie(movie,transfer=null,prefetched=null){
 if(!activeGroup.some(m=>key(m)===key(movie)))configureSourceGroup([movie],movie);
 stop();current=null;requestedMovie=movie;const version=playVersion;$('#online-play-title').textContent=movie.title;$('#online-play-info').textContent=movie.year?movie.year+'':'';$('#episodes').replaceChildren();$('#episode-query').value='';$('#online-description').textContent='';$('#online-buffer').textContent='等待连接';playerStatus('正在获取影片与剧集信息…');
 if(!$('#online-player').open)$('#online-player').showModal();
 if(updatePending)showUpdate();
 // 点开影片就是明确的播放意图：后台预热 hls 组件，与下方详情请求并行，
 // 等真正 playEpisode 时多半已经就绪，省掉一段首帧等待。失败静默，播放时再报。
 loadHls().catch(()=>{});
 try{let d=prefetched?{results:[prefetched]}:null;if(!d)try{d=await api('/api/online/detail',{source:movie.source,id:movie.id});}catch(e){if(!movie.episodes?.length)throw e;d={results:[movie]};}if(version!==playVersion)return;current=d.results.find(m=>m.id===movie.id)||d.results[0];if(!current?.episodes.length&&movie.episodes?.length)current=movie;if(!current||!current.episodes.length)throw Error('这部影片暂时无法播放，请稍后再试。');
  $('#online-play-info').textContent=(current.year?current.year+' · ':'')+current.episodes.length+' 集'+(selectionHint?' · '+selectionHint:'');$('#online-description').textContent=current.description;
  renderCast();
  const point=resumePoint(transfer||history[key(current)],current.episodes);episode=point.index;playEpisode(episode,point.time);
 }catch(e){if(version===playVersion){playerStatus(e.message);autoFailover();}}
}
// hls.min.js 体积大（br 压缩后约 520KB），随首屏加载会明显拖慢打开速度，
// 而且大部分访问只是搜索、并不一定播放。改为真正点开播放时才注入 <script>；
// 加载结果缓存成 Promise，同一页面反复换集/换源也不会重复插入。
let hlsLoading=null;
function loadHls(){
 if(window.Hls?.isSupported())return Promise.resolve();
 if(hlsLoading)return hlsLoading;
 hlsLoading=new Promise((resolve,reject)=>{
  const tag=document.createElement('script');
  tag.src=document.body.dataset.hlsSrc||'/hls.min.js';
  tag.onload=()=>window.Hls?.isSupported()?resolve():reject(Error('播放器组件不可用'));
  tag.onerror=()=>{hlsLoading=null;reject(Error('播放器组件加载失败，请刷新重试'));};
  document.head.append(tag);
 });
 return hlsLoading;
}
async function playEpisode(index,time=0,fromStart=false){
 if(!current?.episodes[index])return;stop();episode=index;const version=playVersion,video=$('#online-video');renderEpisodes();const url=current.episodes[index].url;pendingPlayback={episode:index,episodeTitle:current.episodes[index].title,time};playerStatus('正在连接 · '+current.episodes[index].title);
 stallTimer=setTimeout(()=>{if(version===playVersion&&video.readyState<3)autoFailover('连接较慢，正在为您优化播放线路…');},12000);
 resetPlayerPlus();
 const loaded=()=>{if(version!==playVersion)return;const detected=qualityLabel(video.videoHeight);if(video.videoHeight){currentQuality=(hls&&$('#player-quality').value==='-1'?'自动 · ':'')+detected;qualityMemory[key(current)]=video.videoHeight;qualityMemory=Object.fromEntries(Object.entries(qualityMemory).slice(-500));try{localStorage.setItem('cinema-source-quality-memory',JSON.stringify(qualityMemory));}catch{}if(selectionHint.startsWith('原始画质')){$('#online-play-info').textContent=$('#online-play-info').textContent.replace('原始画质',detected);selectionHint=selectionHint.replace('原始画质',detected);}if(!hls)$('#player-quality').innerHTML=`<option value="0">${detected} · 原始画质</option>`;else if(hls.levels.length===1&&!hls.levels[0].height)$('#player-quality').options[1].textContent=detected;}const seek=fromStart?0:(time||Number(plusPrefs.skipIntro)||0);if(seek>0&&Number.isFinite(video.duration))video.currentTime=Math.min(seek,Math.max(0,video.duration-2));if(typeof plusPrefs.volume==='number')video.volume=Math.max(0,Math.min(1,plusPrefs.volume));if(plusPrefs.muted)video.muted=true;applyPlaybackSpeed(false);video.play().catch(()=>playerStatus('已就绪，请点击播放器中的播放按钮。'));};
 video.onloadedmetadata=loaded;
 if(current.episodes[index].hls!==false&&!window.Hls?.isSupported()){
  playerStatus('正在加载播放器组件…');
  try{await loadHls();}catch(e){playerStatus(e.message);}
 }
 if(version!==playVersion)return; // 等待组件加载期间用户可能已切集或关闭播放器
 if(current.episodes[index].hls!==false&&window.Hls?.isSupported()){
  // 源站按单连接限速（实测单连接约 0.08MB/s，8 连接并发可达 1.9MB/s），
  // 因此改用多连接分片并发拉取 + 更深的预缓冲，尽量吃满叠加带宽。
  let recovered=false,networkRetries=0;hls=new Hls({maxBufferLength:90,maxMaxBufferLength:180,backBufferLength:30,maxBufferSize:120*1000*1000,manifestLoadingTimeOut:15000,fragLoadingTimeOut:30000,manifestLoadingMaxRetry:3,fragLoadingMaxRetry:4,startLevel:-1,abrEwmaDefaultEstimate:3000000,capLevelToPlayerSize:true});
  hls.on(Hls.Events.ERROR,(_event,data)=>{if(version!==playVersion||!data.fatal)return;if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&!recovered){recovered=true;hls.recoverMediaError();}else if(data.type===Hls.ErrorTypes.NETWORK_ERROR&&networkRetries++<1){playerStatus('网络中断，正在重连一次…');if(/manifest|levelLoad/i.test(data.details||''))hls.loadSource(url);else hls.startLoad(video.currentTime||-1);}else{hls.destroy();hls=null;if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=url;playerStatus('切换到浏览器原生 HLS 播放。');}else autoFailover();}});
  configureHlsPlus(hls);
  hls.loadSource(url);hls.attachMedia(video);
 }else video.src=url;
}
$('#online-search').onsubmit=e=>{e.preventDefault();search();};
$('#cancel-search').onclick=()=>{cancelSearch();render();rememberSearch();status('已停止搜索，保留已找到的结果。');};
function switchSource(movie,details=null){const video=$('#online-video');const target=current?(pendingPlayback||{episode,episodeTitle:current.episodes[episode]?.title,time:history[key(current)]?.time||0}):(requestedMovie?history[key(requestedMovie)]:null);const transfer=target?playbackTransfer(target,{time:video.currentTime,readyState:video.readyState}):null;openMovie(movie,transfer,details||(movie.episodes?.length?movie:null));}
function configureSourceGroup(group,movie){
 // 多线路合并成「同一个片子的不同画质来源」，对用户只体现为画质选项；
 // 具体用哪条线路完全由自动优选决定，不再展示线路切换下拉框。
 activeGroup=group;
}
// Probe a bounded number of known source URLs through the existing same-origin proxy.
async function probeSource(movie,episodeTitle='',episodeIndex=0){
 const start=performance.now(), signal=AbortSignal.timeout(8000);
 let details=movie;if(!movie.episodes?.length){const r=await fetch('/api/online/detail?'+new URLSearchParams({source:movie.source,id:movie.id}),{signal});if(!r.ok)throw Error('详情不可用');const data=await r.json();details=data.results?.find(m=>m.id===movie.id)||data.results?.[0]||movie;}const eps=details.episodes||[];
 const item=episodeTitle?(eps.find(e=>e.title===episodeTitle)||(episodeIndex===0&&mediaKind(movie)==='film'?eps[0]:null)):eps[0];
 if(!item||episodeIndex>0&&item.title!==episodeTitle)throw Error('该线路没有对应剧集');
 let url=item.url,height=Math.max(inferredQuality(movie),typeof qualityMemory==='object'?Number(qualityMemory[movie.source+':'+movie.id])||0:0),bitrate=0;
 for(let depth=0;depth<4;depth++){
  const response=await fetch(url,{signal,headers:{Range:'bytes=0-16383'}});if(!response.ok)throw Error('线路不可用');
  if(/mpegurl/i.test(response.headers.get('content-type')||'')){
   const body=await response.text();if(!body.trimStart().startsWith('#EXTM3U'))throw Error('播放列表无效');
   const lines=body.split(/\r?\n/).map(x=>x.trim()),variants=[];
   for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){const next=lines.slice(i+1).find(x=>x&&!x.startsWith('#'));if(next)variants.push({url:next,height:Number(lines[i].match(/RESOLUTION=\d+x(\d+)/i)?.[1])||0,bitrate:Number(lines[i].match(/BANDWIDTH=(\d+)/i)?.[1])||0});}
   if(variants.length){variants.sort((a,b)=>b.height-a.height||b.bitrate-a.bitrate);height=Math.max(height,variants[0].height);bitrate=Math.max(bitrate,variants[0].bitrate);url=new URL(variants[0].url,new URL(url,location.origin)).href;continue;}
   const child=lines.find(x=>x&&!x.startsWith('#'));if(!child)throw Error('没有视频分段');url=new URL(child,new URL(url,location.origin)).href;
  }else{const reader=response.body?.getReader();if(!reader)throw Error('没有视频数据');const first=await reader.read();await reader.cancel();if(!first.value?.length)throw Error('视频分段为空');return {movie,details,ms:Math.round(performance.now()-start),height,bitrate};}
 }
 throw Error('播放列表层级过深');
}
const sourceScore=(probe,target=0)=>target?((probe.height===target?4:probe.height>target?3-(probe.height-target)/target:probe.height?2-(target-probe.height)/target:-1)-probe.ms/8000):((probe.height||540)/720-probe.ms/4000);
async function fastestSource(group,episodeTitle='',episodeIndex=0,target=0){
 // 首个可播源出现后再收集 1.2 秒：清晰度加分、响应耗时扣分，兼顾画质和起播速度。
 const hits=[],probes=[...group].sort((a,b)=>sourceRank(a)-sourceRank(b)).slice(0,target?12:6).map(m=>probeSource(m,episodeTitle,episodeIndex).then(result=>(hits.push(result),result)));
 try{await Promise.any(probes);}catch{return null;}
 await Promise.race([Promise.allSettled(probes),new Promise(resolve=>setTimeout(resolve,target?2500:1200))]);
 return hits.sort((a,b)=>sourceScore(b,target)-sourceScore(a,target)||a.ms-b.ms)[0]||null;
}
async function autoFailover(message='播放不顺畅，正在为您切换更清晰的线路…'){
 if(failoverRunning||!$('#online-player').open||!activeGroup.length)return;
 const remaining=activeGroup.filter(m=>!triedSources.has(key(m))).sort((a,b)=>sourceRank(a)-sourceRank(b));if(!remaining.length){playerStatus('暂时没有更合适的线路，请稍后重试。');return;}
 failoverRunning=true;const version=++probeVersion, old=playVersion,title=current?.episodes[episode]?.title||pendingPlayback?.episodeTitle||'',index=episode;
 const target=Number($('#source-quality').value)||0;playerStatus(message);try{const best=await fastestSource(remaining,title,index,target);
  if(version!==probeVersion||old!==playVersion||!$('#online-player').open)return;
  const video=$('#online-video');if(video.readyState>=3&&!video.paused)return;
  if(best){selectionHint=sourceChoiceHint(best,target);triedSources.add(key(best.movie));switchSource(best.movie,best.details);}else playerStatus('线路暂时繁忙，请稍后重试。');
 }finally{failoverRunning=false;}
}
async function openBest(group){
 const candidate=[...group].sort((a,b)=>((history[key(b)]?.at||0)-(history[key(a)]?.at||0))||(sourceRank(a)-sourceRank(b)))[0];configureSourceGroup(group,candidate);triedSources=new Set();
 const target=Number($('#source-quality').value)||0,version=++probeVersion;$('#online-play-title').textContent=candidate.title;$('#online-play-info').textContent='正在为您选择最佳画质';playerStatus(target?'正在为您准备 '+qualityTargetLabel(target)+' 画质…':'正在为您选择最清晰的画质…');if(!$('#online-player').open)$('#online-player').showModal();
 const best=await fastestSource(group,'',0,target);if(version!==probeVersion||!$('#online-player').open)return;
 const chosen=best?.movie||candidate;selectionHint=best?sourceChoiceHint(best,target):'';const resume=group.map(m=>history[key(m)]).filter(Boolean).sort((a,b)=>(b.at||0)-(a.at||0))[0];triedSources.add(key(chosen));openMovie(chosen,resume||null,best?.details||(chosen.episodes?.length?chosen:null));
}
async function chooseSourceQuality(){
 const target=Number($('#source-quality').value)||0;try{localStorage.setItem('cinema-source-quality-target',String(target));}catch{}if(!$('#online-player').open||!activeGroup.length)return;
 const version=++probeVersion,title=current?.episodes[episode]?.title||pendingPlayback?.episodeTitle||'',index=episode;playerStatus(target?'正在切换到 '+qualityTargetLabel(target)+' 画质…':'正在切换到自动画质…');const best=await fastestSource(activeGroup,title,index,target);if(version!==probeVersion||!$('#online-player').open)return;
 if(!best||target&&!best.height){playerStatus('当前片库暂无 '+qualityTargetLabel(target)+' 画质，已保留当前画质。');return;}if(current&&key(best.movie)===key(current)){playerStatus(target&&best.height&&best.height<target?'已选择当前可用的最接近画质 '+qualityLabel(best.height)+'。':'您正在观看的已是该画质下最佳线路。');return;}selectionHint=sourceChoiceHint(best,target);triedSources.add(key(best.movie));switchSource(best.movie,best.details);
}
$('#source-quality').onchange=chooseSourceQuality;
$('#online-grid').onclick=e=>{const quick=e.target.closest('[data-quick]');if(quick){quickOrganize(quick.dataset.quick,Number(quick.dataset.index));return;}const remove=e.target.closest('[data-remove]');if(remove){removeEntry(Number(remove.dataset.remove));return;}const button=e.target.closest('[data-card]');if(button)openBest(cards[Number(button.dataset.card)]);};
$('#episodes').onclick=e=>{const button=e.target.closest('[data-episode]');if(button){const index=Number(button.dataset.episode);playEpisode(index,episodePosition(index));}};
$('#online-close').onclick=()=>$('#online-player').close();
$('#online-player').addEventListener('close',()=>{probeVersion++;clearTimeout(stallTimer);stop();current=null;if(view!=='search')showSaved(view,true);else render();if(updatePending)showUpdate();});
$('#online-video').onplaying=()=>{clearTimeout(stallTimer);playerStatus('正在播放 · 观看进度自动保存到本机');};
$('#online-video').onwaiting=()=>{playerStatus('缓冲中…');clearTimeout(stallTimer);const v=playVersion;stallTimer=setTimeout(()=>{if(v===playVersion&&!$('#online-video').paused)autoFailover('持续缓冲，正在为您优化播放线路…');},18000);};
$('#online-video').onerror=()=>{if(current&&$('#online-video').getAttribute('src'))autoFailover();};
$('#online-video').onended=()=>{remember();if(!current)return;if(episode===current.episodes.length-1){shelves[key(current)]={...metadata(current),status:'watched',at:Date.now()};save();renderEpisodes();}else if($('#autoplay-next').checked)playEpisode(episode+1);};
$('#online-next').onclick=()=>playEpisode(episode+1,episodePosition(episode+1));
$('#online-prev').onclick=()=>playEpisode(episode-1,episodePosition(episode-1));
function applyPlaybackSpeed(announce=true){
 const rate=Number($('#online-speed').value),video=$('#online-video');video.playbackRate=rate;video.preservesPitch=true;
 if(hls){hls.config.maxBufferLength=Math.max(90,Math.ceil(rate*45));hls.config.maxMaxBufferLength=Math.max(180,Math.ceil(rate*90));hls.config.maxBufferSize=Math.max(120e6,Math.min(180e6,rate*40e6));const limit=speedQualityLimit(rate),auto=$('#player-quality').value==='-1';if(auto&&Number.isFinite(limit)){let cap=-1,best=0;hls.levels.forEach((level,i)=>{const height=level.height||0;if(height<=limit&&height>=best){best=height;cap=i;}});hls.autoLevelCapping=cap;}else hls.autoLevelCapping=-1;}
 if(announce){playerStatus("已切换 "+rate+" 倍速");}
}
$('#online-speed').onchange=()=>{applyPlaybackSpeed();savePreferences();};
$('#retry-online').onclick=()=>{const m=current||requestedMovie;if(m){remember();openMovie(m);}};
$('#online-favorite').onclick=()=>{if(!current)return;const id=key(current);if(favorites[id])delete favorites[id];else favorites[id]={...metadata(current),at:Date.now()};save();renderEpisodes();};
setInterval(remember,5000);window.addEventListener('pagehide',remember);
function showSaved(mode,preserve=false){if(view==='search')rememberSearch();cancelSearch();view=mode;$('#back-search').hidden=!searchSnapshot?.results?.length;results=Object.values(mode==='favorites'?favorites:mode==='history'?history:shelves).filter(m=>!['watchlist','watched'].includes(mode)||m.status===mode).map(m=>({...m,actors:m.actors||history[key(m)]?.actors,director:m.director||history[key(m)]?.director,genre:m.genre||history[key(m)]?.genre})).sort((a,b)=>(b.at||0)-(a.at||0));if(!preserve){clearFilters();$('#online-sort').value='recent';}$('#online-title').textContent=({favorites:'我的在线收藏',history:'继续观看 · 在线影视',watchlist:'在线待看',watched:'在线已看完'})[mode];$('#actor-panel').hidden=true;$('#source-progress').replaceChildren();$('#retry-failed').hidden=true;render();updateCounts();status(results.length?results.length+' 条记录，点击即可继续观看。':'这里还没有影片，搜索后即可收藏或观看。');}
$('#saved-view').onclick=()=>showSaved('favorites');$('#history-view').onclick=()=>showSaved('history');




async function syncSourceList(announce=false){
 try{const [d,h]=await Promise.all([api('/api/online/sources'),api('/api/source-health')]);const pending=d.sources.filter(s=>!h.sources[s.id]).length,failed=d.sources.filter(s=>h.sources[s.id]?.enabled===false).length;sources=d.sources.filter(s=>h.sources[s.id]?.enabled===true);selected=Array.isArray(selected)?selected.filter(id=>sources.some(s=>s.id===id)):sources.map(s=>s.id);if(announce)status(`已就绪 · 支持片名、演员和导演搜索。`);}
 catch{if(announce)status('播放服务正在连接，稍等片刻即可搜索。');}
}
syncSourceList(true);
loadDoubanHot();
document.querySelector('.douban-tabs').onclick=e=>{const button=e.target.closest('[data-douban-type]');if(!button)return;document.querySelectorAll('[data-douban-type]').forEach(x=>x.classList.toggle('active',x===button));loadDoubanHot(button.dataset.doubanType);};
$('#douban-grid').onclick=e=>{const button=e.target.closest('[data-douban-title]');if(!button)return;$('#query').value=button.dataset.doubanTitle;$('#search-kind').value='title';search();document.querySelector('.online-library').scrollIntoView({behavior:'smooth'});};

function updateCounts(){
 const counts={'saved-view':Object.keys(favorites).length,'history-view':Object.keys(history).length,'watchlist-view':Object.values(shelves).filter(m=>m.status==='watchlist').length,'watched-view':Object.values(shelves).filter(m=>m.status==='watched').length};
 for(const [id,count] of Object.entries(counts))$('#'+id+' small').textContent=count;
 for(const [id,mode] of [['saved-view','favorites'],['history-view','history'],['watchlist-view','watchlist'],['watched-view','watched']])$('#'+id).classList.toggle('active',view===mode);
 document.querySelector('a.nav[href="/online"]').classList.toggle('active',view==='search');
}
function clearFilters(){visibleLimit=48;$('#result-search').value='';$('#online-genre').value='';$('#online-kind').value='';$('#online-year').value='';$('#online-source-filter').value='';$('#online-sort').value=preferences.sort||'relevance';}
function savePreferences(){preferences={sort:$('#online-sort').value,hideExtras:$('#hide-extras').checked,speed:$('#online-speed').value,autoplay:$('#autoplay-next').checked};try{localStorage.setItem('cinema-online-preferences',JSON.stringify(preferences));}catch{}}
function renderRecent(){$('#recent-searches').innerHTML=recent.map(q=>`<button type="button" data-query="${esc(q)}">${esc(q)}</button>`).join('');$('#clear-recent').hidden=!recent.length;}
$('#recent-searches').onclick=e=>{const button=e.target.closest('[data-query]');if(button){$('#query').value=button.dataset.query;search();}};
$('#clear-recent').onclick=()=>{recent=[];localStorage.removeItem('cinema-online-recent');renderRecent();};
$('#retry-failed').onclick=()=>search(true);
for(const id of ['online-year','online-source-filter','online-sort','hide-extras','online-genre','online-kind'])$('#'+id).onchange=()=>{visibleLimit=48;savePreferences();render();};
$('#result-search').oninput=()=>{visibleLimit=48;render();};
$('#online-clear-filters').onclick=()=>{clearFilters();$('#hide-extras').checked=false;savePreferences();render();};
$('#watchlist-view').onclick=()=>showSaved('watchlist');$('#watched-view').onclick=()=>showSaved('watched');
function removeEntry(i){if(view==='search'||!cards[i])return;const store=view==='favorites'?favorites:view==='history'?history:shelves;const entries=removeGroupEntries(store,cards[i]);if(!Object.keys(entries).length)return;cardUndo={store:view==='favorites'?'favorites':view==='history'?'history':'shelves',entries};save();$('#undo-remove').hidden=false;showSaved(view,true);status('已移除该影片的记录，可撤销。');}
$('#undo-remove').onclick=()=>{if(!cardUndo)return;const target=cardUndo.store==='favorites'?favorites:cardUndo.store==='history'?history:shelves;for(const [id,entry] of Object.entries(cardUndo.entries))if(!Object.hasOwn(target,id))target[id]=entry;cardUndo=null;$('#undo-remove').hidden=true;save();if(view!=='search')showSaved(view,true);else render();status('已恢复移除的影片记录。');};
$('#surprise-view').onclick=()=>{const pool=[...Object.values(shelves).filter(m=>m.status==='watchlist'),...Object.values(favorites),...Object.values(history)];if(!pool.length){status('待看、收藏和续播还没有影片；先搜索并添加几部，再来抽一部。');return;}const pick=pool[Math.floor(Math.random()*pool.length)];status('随便看看：'+pick.title+(view==='search'?'':''));openMovie({...pick});};
for(const [id,value] of [['online-watchlist','watchlist'],['online-watched','watched']])$('#'+id).onclick=()=>{if(!current)return;const id=key(current);if(shelves[id]?.status===value)delete shelves[id];else shelves[id]={...metadata(current),status:value,at:Date.now()};save();renderEpisodes();};
$('#online-restart').onclick=()=>{if(!current)return;playEpisode(episode,0,true);delete history[key(current)];save();};
$('#episode-query').oninput=()=>{if(current)renderEpisodes();};
$('#reverse-episodes').onclick=()=>{episodeReversed=!episodeReversed;$('#reverse-episodes').textContent=episodeReversed?'恢复正序':'倒序选集';if(current)renderEpisodes();};
$('#autoplay-next').onchange=savePreferences;
setInterval(()=>{if(!current||!$('#online-player').open)return;const video=$('#online-video');let ahead=0;for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=video.currentTime&&video.buffered.end(i)>=video.currentTime)ahead=video.buffered.end(i)-video.currentTime;$('#online-buffer').textContent=(video.paused?'已暂停':'播放中')+' · '+currentQuality+' · 已缓冲 '+Math.round(ahead)+' 秒';},1000);
function downloadBackup(){remember();const data={app:'cinema-online',version:1,at:new Date().toISOString(),favorites,history,shelves};const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.href=url;link.download='光影在线记录-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export-online').onclick=downloadBackup;
$('#import-online').onclick=()=>$('#backup-file').click();
$('#backup-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>8000000)throw Error('备份文件超过 8 MB。');const data=validateBackup(JSON.parse(await file.text()));undoBackup={favorites:structuredClone(favorites),history:structuredClone(history),shelves:structuredClone(shelves)};favorites={...data.favorites,...favorites};shelves={...data.shelves,...shelves};for(const [id,m] of Object.entries(data.history))history[id]=mergeEpisodeHistory(history[id],m);save();$('#undo-import').hidden=false;status('备份已合并，保留当前收藏与状态，各集进度分别保留较新的记录。可撤销此次导入。');if(view!=='search')showSaved(view,true);else render();}catch(error){status(error.message||'备份读取失败。');}e.target.value='';};
$('#undo-import').onclick=()=>{if(!undoBackup)return;const live=current?history[key(current)]:null;({favorites,history,shelves}=undoBackup);if(live)history[key(current)]=live;undoBackup=null;save();$('#undo-import').hidden=true;if(view!=='search')showSaved(view,true);else render();status('已撤销导入。');};
let updatePending=false,applyAfterPlayback=false;
function showUpdate(){const playing=$('#online-player').open;$('#update-banner').hidden=playing;$('#player-update').hidden=!playing;$('#update-message').textContent='新版已就绪，点击应用更新。';}
$('#defer-update').onclick=()=>{applyAfterPlayback=true;$('#defer-update').textContent='已安排：关闭播放器后更新';$('#defer-update').disabled=true;};
$('#apply-update').onclick=()=>{if($('#online-player').open){applyAfterPlayback=true;$('#update-message').textContent='将在关闭播放器后更新，当前播放继续。';return;}remember();location.reload();};
$('#online-player').addEventListener('close',()=>{if(updatePending&&applyAfterPlayback){remember();location.reload();}});
setInterval(async()=>{if(document.hidden)return;try{const text=await(await fetch('/online.js?check-update=1',{cache:'no-store'})).text();const next=text.match(/const CINEMA_BUILD='([^']+)'/)?.[1];if(next&&next!==CINEMA_BUILD){updatePending=true;showUpdate();}}catch{}},60000);
if(['relevance','year-desc','year-asc','sources','recent'].includes(preferences.sort))$('#online-sort').value=preferences.sort;
$('#hide-extras').checked=preferences.hideExtras!==false;
if(['0.75','1','1.25','1.5','2','2.5','3','3.5','4','4.5','5'].includes(preferences.speed))$('#online-speed').value=preferences.speed;
if(['0','720','1080','1440','2160'].includes(localStorage.getItem('cinema-source-quality-target')))$('#source-quality').value=localStorage.getItem('cinema-source-quality-target');
$('#autoplay-next').checked=preferences.autoplay!==false;
renderRecent();updateCounts();render();

function rememberSearch(){
 if(view!=='search'||!results.length)return;searchSnapshot={at:searchAt||Date.now(),query:lastQuery,kind:$('#search-kind').value,results:results.slice(0,500).map(m=>({...metadata(m),actors:m.actors,director:m.director})),truncated:results.length>500,text:$('#result-search').value,genre:$('#online-genre').value,year:$('#online-year').value,source:$('#online-source-filter').value,sort:$('#online-sort').value,hideExtras:$('#hide-extras').checked,limit:visibleLimit};
 $('#back-search').hidden=true;try{sessionStorage.setItem('cinema-last-search',JSON.stringify(searchSnapshot));}catch{}
}
function restoreSearch(snapshot){
 if(!snapshot||Date.now()-snapshot.at>600000||!Array.isArray(snapshot.results))return false;
 cancelSearch();view='search';results=snapshot.results.filter(m=>m&&typeof m.id==='string'&&typeof m.source==='string'&&typeof m.title==='string');searchAt=snapshot.at;lastQuery=String(snapshot.query||'');$('#query').value=lastQuery;$('#search-kind').value=['auto','title','actor'].includes(snapshot.kind)?snapshot.kind:'auto';visibleLimit=Math.max(48,Math.min(1000,Number(snapshot.limit)||48));$('#online-sort').value=snapshot.sort||'relevance';$('#hide-extras').checked=!!snapshot.hideExtras;$('#actor-panel').hidden=true;$('#result-search').value=snapshot.text||'';$('#source-progress').replaceChildren();$('#online-title').textContent='搜索：'+lastQuery;render();$('#online-genre').value=onlineGenres(snapshot.genre)[0]||'';$('#online-year').value=snapshot.year||'';$('#online-source-filter').value=snapshot.source||'';render();updateCounts();$('#back-search').hidden=true;status(snapshot.truncated?'已恢复前 500 条搜索结果，可重新搜索获取完整结果。':'已恢复本页最近搜索结果；如无法播放，请重新搜索。');return true;
}
$('#online-more').onclick=()=>{visibleLimit+=48;render();rememberSearch();};
$('#back-search').onclick=()=>{if(!restoreSearch(searchSnapshot))status('搜索记录已过期，请重新搜索。');};
window.addEventListener('pagehide',rememberSearch);
try{searchSnapshot=JSON.parse(sessionStorage.getItem('cinema-last-search')||'null');}catch{}
if(searchSnapshot)restoreSearch(searchSnapshot);

function quickOrganize(action,index){
 const group=cards[index];if(!group?.length)return;
 const movie=[...group].sort((a,b)=>(history[key(b)]?.at||0)-(history[key(a)]?.at||0))[0];
 if(action==='favorite'){
  if(group.some(m=>favorites[key(m)]))removeGroupEntries(favorites,group);else favorites[key(movie)]={...metadata(movie),at:Date.now()};
 }else if(action==='watchlist'){
  const marked=group.filter(m=>shelves[key(m)]?.status==='watchlist');
  if(marked.length)removeGroupEntries(shelves,marked);else shelves[key(movie)]={...metadata(movie),status:'watchlist',at:Date.now()};
 }else return;
 save();if(view==='search')render();else showSaved(view,true);
}

// Local player features and public metadata adapters. No external comment posting.
const plusPrefs=stored('cinema-player-plus',{});
let danmakuItems=[],danmakuKey='',danmakuRequest=0,localNotes=stored('cinema-danmaku-local',{}),subtitleUrl='',abStart=null,abEnd=null,sleepTimer=null,danmakuFrame=0;
const danmakuLibrary=new Map();
let actorTitles=[],subtitleSource='',subtitleName='',subtitleRequest=0;
function plusSave(){try{localStorage.setItem('cinema-player-plus',JSON.stringify(plusPrefs));}catch{}}
function episodeKey(){return current?filmKey(current)+':'+episode:'';}
async function showActorWorks(name,version,explicit){
 try{const d=await api('/api/actor',{q:name});if(version!==searchVersion)return;
  $('#actor-panel').hidden=false;$('#actor-label').textContent=name+' · 作品列表';$('#actor-source').href=d.source;$('#actor-source').textContent=d.attribution;
  actorTitles=d.works;$('#actor-work-filter').value='';renderActorWorks();
  if(explicit)status('找到 '+d.works.length+' 部相关作品，点选片名即可搜索观看。');
 }catch(e){if(explicit&&version===searchVersion)status('演员资料暂不可用：'+e.message);}
}
function renderActorWorks(){const q=$('#actor-work-filter').value.trim().toLocaleLowerCase();const titles=actorTitles.filter(t=>t.toLocaleLowerCase().includes(q));$('#actor-works').innerHTML=titles.map(title=>`<button data-work="${esc(title)}">${esc(title)}</button>`).join('')||'<p>没有匹配作品，可换个关键词。</p>';$('#actor-work-count').textContent=titles.length+' / '+actorTitles.length+' 条';}
$('#actor-work-filter').oninput=renderActorWorks;
$('#actor-works').onclick=e=>{const b=e.target.closest('[data-work]');if(b){$('#query').value=b.dataset.work;$('#search-kind').value='title';search();}};
function renderCast(){const names=(current?.actors||'').split(/[,，、\/]/).map(s=>s.trim()).filter(Boolean).slice(0,16);$('#cast-links').innerHTML=(current?.director?`<span>导演：${esc(current.director)}</span>`:'')+names.map(name=>`<button data-actor="${esc(name)}">${esc(name)}</button>`).join('');}
$('#cast-links').onclick=e=>{const b=e.target.closest('[data-actor]');if(b){$('#online-player').close();$('#query').value=b.dataset.actor;$('#search-kind').value='actor';search();}};



function resetPlayerPlus(){
 danmakuRequest++;$('#danmaku-file').value='';danmakuKey=episodeKey();danmakuItems=danmakuLibrary.get(danmakuKey)||normalizeDanmaku(localNotes[danmakuKey]||[]);abStart=null;abEnd=null;$('#ab-status').textContent='A–B 未设置';$('#danmaku-results').replaceChildren();$('#danmaku-status').textContent='可搜索并选择同版本视频弹幕，或导入 XML/JSON。';
 clearSubtitle();$('#danmaku-origin').hidden=true;$('#danmaku-origin').removeAttribute('href');$('#danmaku-query').value=current?.title||'';
 currentQuality='自动画质';$('#player-quality').innerHTML='<option value="-1">自动画质</option>';$('#player-audio').innerHTML='<option value="0">默认音轨</option>';
 startDanmaku();
}
function configureHlsPlus(instance){
 instance.on(Hls.Events.MANIFEST_PARSED,()=>{if(instance!==hls)return;$('#player-quality').innerHTML='<option value="-1">自动画质（速度自适应）</option>'+instance.levels.map((level,i)=>`<option value="${i}">${qualityLabel(level.height)}${level.bitrate?' · '+(level.bitrate/1000000).toFixed(1)+' Mbps':''}</option>`).join('');applyPlaybackSpeed(false);});
 instance.on(Hls.Events.LEVEL_SWITCHED,(_event,data)=>{if(instance!==hls)return;const level=instance.levels[data.level];if(level)currentQuality=($('#player-quality').value==='-1'?'自动 · ':'')+qualityLabel(level.height||$('#online-video').videoHeight);});
 instance.on(Hls.Events.AUDIO_TRACKS_UPDATED,()=>{if(instance!==hls)return;$('#player-audio').innerHTML=instance.audioTracks.map((track,i)=>`<option value="${i}">${esc(track.name||track.lang||'音轨 '+(i+1))}</option>`).join('')||'<option value="0">默认音轨</option>';});
}
$('#player-quality').onchange=()=>{if(hls){hls.currentLevel=Number($('#player-quality').value);currentQuality=$('#player-quality').value==='-1'?'自动':$('#player-quality').selectedOptions[0].textContent.split(' · ')[0];applyPlaybackSpeed(false);}};$('#player-audio').onchange=()=>{if(hls)hls.audioTrack=Number($('#player-audio').value);};
$('#player-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#video-stage').requestFullscreen();}catch{playerStatus('当前浏览器暂不支持此全屏操作。');}};
$('#player-pip').onclick=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await $('#online-video').requestPictureInPicture();}catch{playerStatus('画中画暂不可用，请等待视频就绪后重试。');}};
$('#player-screenshot').onclick=()=>{try{const video=$('#online-video');if(!video.videoWidth)throw Error('请等画面载入后截图。');const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);if($('#danmaku-enabled').checked)ctx.drawImage($('#danmaku-canvas'),0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(current?.title||'电影')+'-'+Math.floor(video.currentTime)+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}catch(e){playerStatus(e.message||'此视频不允许截图。');}};
$('#mark-a').onclick=()=>{abStart=$('#online-video').currentTime;abEnd=null;$('#ab-status').textContent='A '+formatTime(abStart)+'，请选择 B 点';};
$('#mark-b').onclick=()=>{const time=$('#online-video').currentTime;if(abStart===null||time<=abStart+1){playerStatus('请先设置 A 点，再在至少 1 秒后设置 B 点。');return;}abEnd=time;$('#ab-status').textContent=formatTime(abStart)+' → '+formatTime(abEnd)+' 循环';};
$('#clear-ab').onclick=()=>{abStart=abEnd=null;$('#ab-status').textContent='A–B 未设置';};
function formatTime(seconds){return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');}
$('#online-video').addEventListener('timeupdate',()=>{if(abStart!==null&&abEnd!==null&&$('#online-video').currentTime>=abEnd)$('#online-video').currentTime=abStart;});
$('#sleep-timer').onchange=()=>{clearTimeout(sleepTimer);const minutes=Number($('#sleep-timer').value);if(minutes)sleepTimer=setTimeout(()=>{$('#online-video').pause();playerStatus('定时暂停已执行。');$('#sleep-timer').value='0';},minutes*60000);};
$('#skip-intro').value=Number(plusPrefs.skipIntro)||0;$('#skip-intro').onchange=()=>{plusPrefs.skipIntro=Math.max(0,Math.min(600,Number($('#skip-intro').value)||0));$('#skip-intro').value=plusPrefs.skipIntro;plusSave();};
$('#video-brightness').oninput=()=>$('#online-video').style.filter='brightness('+Number($('#video-brightness').value)+'%)';
$('#online-video').addEventListener('volumechange',()=>{plusPrefs.volume=$('#online-video').volume;plusPrefs.muted=$('#online-video').muted;plusSave();});
document.addEventListener('keydown',e=>{if(!$('#online-player').open||e.ctrlKey||e.metaKey||e.altKey||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)||e.target.isContentEditable)return;const v=$('#online-video');if(e.code==='Space'){e.preventDefault();v.paused?v.play().catch(()=>{}):v.pause();}else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();v.currentTime=Math.max(0,Math.min(Number.isFinite(v.duration)?v.duration:Infinity,v.currentTime+(e.key==='ArrowRight'?10:-10)));}else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();v.volume=Math.max(0,Math.min(1,v.volume+(e.key==='ArrowUp'?.05:-.05)));}else if(/^[0-9]$/.test(e.key)){e.preventDefault();if(Number.isFinite(v.duration))v.currentTime=v.duration*Number(e.key)/10;}else if(e.key==='['){e.preventDefault();$('#online-prev').click();}else if(e.key===']'){e.preventDefault();$('#online-next').click();}else if(e.key.toLowerCase()==='m')v.muted=!v.muted;else if(!e.repeat&&e.key.toLowerCase()==='f')$('#player-fullscreen').click();});
function clearSubtitle(){
 subtitleRequest++;subtitleSource='';subtitleName='';$('#subtitle-file').value='';if(subtitleUrl){URL.revokeObjectURL(subtitleUrl);subtitleUrl='';}$('#online-video').querySelectorAll('track').forEach(t=>t.remove());$('#subtitle-offset').value=0;$('#subtitle-status').textContent='可载入本机 SRT/VTT 字幕';
}
function applySubtitle(vtt){
 if(subtitleUrl)URL.revokeObjectURL(subtitleUrl);$('#online-video').querySelectorAll('track').forEach(t=>t.remove());
 subtitleUrl=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));const url=subtitleUrl,track=document.createElement('track');track.kind='subtitles';track.label=subtitleName;track.srclang='zh';track.default=$('#subtitle-enabled').checked;track.src=url;
 track.addEventListener('load',()=>{if(url===subtitleUrl)track.track.mode=$('#subtitle-enabled').checked?'showing':'hidden';});
 track.addEventListener('error',()=>{if(url===subtitleUrl)$('#subtitle-status').textContent='字幕载入失败，可检查文件编码或换一份字幕。';});
 $('#online-video').append(track);$('#subtitle-status').textContent=subtitleName+' · 偏移 '+Number($('#subtitle-offset').value||0)+' 秒';
}
$('#subtitle-file').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;const request=++subtitleRequest,version=playVersion;
 try{if(file.size>2*1024*1024)throw Error('字幕文件超过 2 MB。');const text=await file.text();if(request!==subtitleRequest||version!==playVersion)return;const vtt=subtitleToVtt(text,$('#subtitle-offset').value);subtitleSource=text;subtitleName=file.name;applySubtitle(vtt);}
 catch(error){if(request===subtitleRequest&&version===playVersion)$('#subtitle-status').textContent=error.message;}
 finally{if(request===subtitleRequest)e.target.value='';}
};
$('#subtitle-offset').onchange=()=>{const shift=Math.max(-3600,Math.min(3600,Number($('#subtitle-offset').value)||0));$('#subtitle-offset').value=shift;if(subtitleSource){try{applySubtitle(subtitleToVtt(subtitleSource,shift));}catch(e){$('#subtitle-status').textContent=e.message;}}};
$('#subtitle-enabled').checked=plusPrefs.subtitles!==false;
$('#subtitle-enabled').onchange=()=>{plusPrefs.subtitles=$('#subtitle-enabled').checked;plusSave();for(const track of $('#online-video').textTracks)if(track.kind==='subtitles')track.mode=plusPrefs.subtitles?'showing':'hidden';};
$('#subtitle-clear').onclick=clearSubtitle;
function parseDanmaku(text){
 if(text.trimStart().startsWith('<')){if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('不支持含实体声明的 XML。');const xml=new DOMParser().parseFromString(text,'application/xml');if(xml.querySelector('parsererror'))throw Error('XML 弹幕格式无效。');return normalizeDanmaku([...xml.querySelectorAll('d')].map(d=>{const p=(d.getAttribute('p')||'').split(',');return {time:Number(p[0]),mode:Number(p[1]),color:Number(p[3]),text:d.textContent};}));}
 return normalizeDanmaku(JSON.parse(text));
}
function mergeDanmaku(items){danmakuItems=normalizeDanmaku([...danmakuItems,...items]);danmakuLibrary.set(danmakuKey,danmakuItems);if(danmakuLibrary.size>8)danmakuLibrary.delete(danmakuLibrary.keys().next().value);$('#danmaku-status').textContent='已加载 '+danmakuItems.length+' 条弹幕；可调整时间偏移与显示密度。';startDanmaku();}
$('#danmaku-file').onchange=async e=>{const version=danmakuRequest,target=danmakuKey;try{for(const file of [...e.target.files]){if(file.size>8*1024*1024)throw Error('单个弹幕文件超过 8 MB。');const text=await file.text();if(version!==danmakuRequest||target!==danmakuKey)return;mergeDanmaku(parseDanmaku(text));}}catch(error){if(version===danmakuRequest&&target===danmakuKey)$('#danmaku-status').textContent=error.message;}finally{if(version===danmakuRequest)e.target.value='';}};
let matchedBvid='';
$('#danmaku-search-form').onsubmit=async e=>{e.preventDefault();const q=$('#danmaku-query').value.trim()||current?.title;if(!q)return;const version=++danmakuRequest;$('#danmaku-status').textContent='正在查找哔哩哔哩弹幕…';try{const bvid=q.match(/BV[a-zA-Z0-9]{10}/)?.[0];if(bvid){await showBiliParts(bvid,version);return;}const d=await api('/api/danmaku/search',{q});if(version!==danmakuRequest)return;$('#danmaku-results').innerHTML=d.videos.map(v=>`<button data-bvid="${esc(v.bvid)}">${esc(v.title)} · ${esc(v.author)} · ${esc(v.duration)}</button>`).join('');$('#danmaku-status').textContent='请选择与当前电影相同的版本；片段和解说的时间轴可能不同。';}catch(error){if(version===danmakuRequest)$('#danmaku-status').textContent='搜索暂不可用，可粘贴 BV 号或导入 XML/JSON：'+error.message;}};
async function showBiliParts(bvid,version){const d=await api('/api/danmaku/parts',{bvid});if(version!==danmakuRequest)return;matchedBvid=bvid;$('#danmaku-results').innerHTML=d.parts.map(part=>`<button data-cid="${part.cid}">P${part.page} ${esc(part.title)}</button>`).join('');$('#danmaku-status').textContent=d.title+' · 请选择分 P 加载弹幕';}
$('#danmaku-results').onclick=async e=>{const bv=e.target.closest('[data-bvid]'),part=e.target.closest('[data-cid]');if(!bv&&!part)return;const version=++danmakuRequest;try{if(bv)return await showBiliParts(bv.dataset.bvid,version);if(part){$('#danmaku-status').textContent='正在加载弹幕…';const r=await fetch(EXT_ORIGIN+'/api/danmaku/comments?cid='+part.dataset.cid,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('弹幕接口暂不可用');const text=await r.text();if(version!==danmakuRequest)return;mergeDanmaku(parseDanmaku(text));$('#danmaku-origin').href='https://www.bilibili.com/video/'+matchedBvid;$('#danmaku-origin').hidden=false;}}catch(error){if(version===danmakuRequest)$('#danmaku-status').textContent=error.message;}};
$('#local-danmaku-form').onsubmit=e=>{e.preventDefault();if(!current)return;const text=$('#local-danmaku-text').value.trim();if(!text)return;const entry={time:$('#online-video').currentTime,text,color:'#ffffff',mode:1};localNotes[danmakuKey]=[...(localNotes[danmakuKey]||[]),entry].slice(-500);try{localStorage.setItem('cinema-danmaku-local',JSON.stringify(localNotes));mergeDanmaku([entry]);$('#local-danmaku-text').value='';}catch{$('#danmaku-status').textContent='本机存储空间不足，未保存这条弹幕。';}};
if(plusPrefs['danmaku-block']!==undefined)$('#danmaku-block').value=plusPrefs['danmaku-block'];
for(const id of ['danmaku-enabled','danmaku-density','danmaku-opacity','danmaku-offset','danmaku-block']){if(plusPrefs[id]!==undefined){const el=$('#'+id);if(el.type==='checkbox')el.checked=!!plusPrefs[id];else el.value=plusPrefs[id];}$('#'+id).onchange=()=>{const el=$('#'+id);plusPrefs[id]=el.type==='checkbox'?el.checked:el.value;plusSave();startDanmaku();};}
function blockedDanmaku(text){const words=String(plusPrefs['danmaku-block']||'').split(/[,，、\s]+/).map(s=>s.trim().toLowerCase()).filter(Boolean);return !words.length?false:words.some(w=>text.toLowerCase().includes(w));}
function startDanmaku(){cancelAnimationFrame(danmakuFrame);const canvas=$('#danmaku-canvas'),ctx=canvas.getContext('2d');let lastDraw=-1000;
 function frame(stamp=0){if(stamp-lastDraw<1000/30){danmakuFrame=requestAnimationFrame(frame);return;}lastDraw=stamp;if(!$('#online-player').open){ctx.clearRect(0,0,canvas.width,canvas.height);return;}const bounds=$('#video-stage').getBoundingClientRect(),width=Math.round(bounds.width),height=Math.round(bounds.height);if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}ctx.clearRect(0,0,width,height);
  if($('#danmaku-enabled').checked){const time=$('#online-video').currentTime-Number($('#danmaku-offset').value||0),duration=8,start=danmakuStart(danmakuItems,time-duration),end=danmakuStart(danmakuItems,time+.01),count=Number($('#danmaku-density').value),lanes=Math.max(1,Math.floor(height*.65/30));ctx.font='bold '+Math.max(17,Math.min(25,width/48))+'px sans-serif';ctx.globalAlpha=Number($('#danmaku-opacity').value)/100;ctx.lineWidth=3;ctx.strokeStyle='#000';for(let i=start;i<Math.min(end,start+count);i++){const d=danmakuItems[i],age=time-d.time;if(age<0||age>duration||blockedDanmaku(d.text))continue;const textWidth=ctx.measureText(d.text).width,lane=i%lanes;let x=width-(width+textWidth)*age/duration,y=30+lane*30;if(d.mode===5||d.mode===4){if(age>4)continue;x=(width-textWidth)/2;y=d.mode===5?30+lane%3*30:height-70-lane%3*30;}ctx.fillStyle=d.color;ctx.strokeText(d.text,x,y);ctx.fillText(d.text,x,y);}}
  if(!$('#online-video').paused&&!$('#online-video').ended&&$('#danmaku-enabled').checked&&!document.hidden)danmakuFrame=requestAnimationFrame(frame);
 }frame();}
$('#online-video').addEventListener('playing',startDanmaku);$('#online-video').addEventListener('seeked',startDanmaku);window.addEventListener('resize',()=>{if($('#online-player').open)startDanmaku();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('#online-player').open)startDanmaku();});
$('#online-player').addEventListener('close',()=>{cancelAnimationFrame(danmakuFrame);danmakuRequest++;$('#danmaku-file').value='';clearTimeout(sleepTimer);$('#sleep-timer').value='0';clearSubtitle();});

// VipVideo platform/list configuration adapter. Original MIT notice is retained.
let platformList=[];
function drawPlatforms(){const custom=stored('cinema-custom-platforms',[]);$('#platform-links').innerHTML=[...platformList,...custom].map(p=>`<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)} ↗</a>`).join('');$('#custom-platforms').innerHTML=custom.map((p,i)=>`<div><span>${esc(p.name)}</span><button data-up="${i}" aria-label="上移 ${esc(p.name)}">↑</button><button data-remove="${i}" aria-label="移除 ${esc(p.name)}">移除</button></div>`).join('');}
$('#platforms-open').onclick=async()=>{$('#platforms-dialog').showModal();try{const d=await api('/api/platforms');platformList=d.platforms;drawPlatforms();}catch(e){$('#platform-status').textContent=e.message;}};
$('#platforms-close').onclick=()=>$('#platforms-dialog').close();
$('#add-platform').onsubmit=e=>{e.preventDefault();try{const url=new URL($('#platform-url').value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('请填写普通 HTTP/HTTPS 地址。');const list=stored('cinema-custom-platforms',[]);if(list.length>=30)throw Error('最多保存 30 个自定义入口。');list.push({name:$('#platform-name').value.trim().slice(0,30)||url.hostname,url:url.href});localStorage.setItem('cinema-custom-platforms',JSON.stringify(list));$('#platform-url').value='';$('#platform-name').value='';$('#platform-status').textContent='已保存到本机。';drawPlatforms();}catch(error){$('#platform-status').textContent=error.message;}};
$('#custom-platforms').onclick=e=>{const list=stored('cinema-custom-platforms',[]),remove=e.target.closest('[data-remove]'),up=e.target.closest('[data-up]');if(remove)list.splice(Number(remove.dataset.remove),1);else if(up){const i=Number(up.dataset.up);if(i>0)[list[i-1],list[i]]=[list[i],list[i-1]];}else return;localStorage.setItem('cinema-custom-platforms',JSON.stringify(list));drawPlatforms();};
