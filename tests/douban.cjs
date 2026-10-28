const fs=require('fs'),vm=require('vm'),assert=require('assert');
let s="const UA='test';\n"+fs.readFileSync('functions/api/douban.js','utf8').replace(/^import .*$/m,'').replace(/export /g,'');
assert.match(s, /type === 'tv' \? 'tv_hot' : 'movie_hot_gaia'/);
const x=vm.runInNewContext(s+';({mapHot,mapSearch})');
assert.deepEqual(JSON.parse(JSON.stringify(x.mapSearch({id:'1',title:'鹿鼎记',year:'1998',target_type:'tv',rating:{value:9.1,count:2},pic:{normal:'p'}}))),{id:'1',title:'鹿鼎记',year:'1998',poster:'p',rating:9.1,ratingCount:2,kind:'series'});
assert.equal(x.mapHot({id:'2',title:'电影',rating:{value:8}}).kind,'film');
assert.deepEqual(JSON.parse(JSON.stringify(x.mapSearch({target_type:'movie',target:{id:'2',title:'鹿鼎记',year:'1992',rating:{value:8.4,count:9},cover_url:'c'}}))),{id:'2',title:'鹿鼎记',year:'1992',poster:'c',rating:8.4,ratingCount:9,kind:'film'});
console.log('douban mapping passed');
