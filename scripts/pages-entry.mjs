// 生成 Pages 入口文件，并给静态资源引用加上内容指纹版本号。
//
// 1) index.html 由 online.html 复制而来。Cloudflare Pages 会自动把 /online.html
//    重定向到 /online，若在 _redirects 里写 "/ -> /online.html" 会与这条规则
//    形成 308 死循环，所以改为直接产出 index.html。
//
// 2) 版本号自动化：把 HTML 里的 `?v=手写数字` 替换成 `?v=<文件内容 hash 前 8 位>`。
//    配合 web/_headers 的一年期 immutable 缓存，改代码只要重新部署就会让用户端
//    自动刷新，不需要再手工同步维护 "改了 JS 还得改 HTML 里的 ?v=" —— 这正是
//    此前 live.html 引用 online.css?v=11 而 online.html 用 v=12 的不一致根因。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(base, 'web');

const hashOf = file => crypto.createHash('sha256')
  .update(fs.readFileSync(file))
  .digest('hex')
  .slice(0, 8);

// 匹配 src/href/data-hls-src 指向本地 .js/.css 的引用，无论原来带不带 ?v=，
// 统一换成内容指纹。data-hls-src 是 hls.min.js 的按需加载地址，由 JS 运行时读取。
const V_RE = /(src|href|data-hls-src)="\/([^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g;
// 防御：本脚本会写回源文件，一旦产出坏 HTML（例如把 `src="a"` 替换成 `src="a"="a"`）
// 就会污染源码并随部署上线 —— 第一次实现时就发生过，上线了 17 处重复属性。
// 所以写入前必须校验，且校验不过就中止而不是写坏文件。
const BAD_ATTR = /(src|href)="[^"]+"="\/[^"]*"/;
function fingerprint(html) {
  const next = html.replace(V_RE, (_match, tag, file) => {
    const abs = path.join(web, file);
    if (!fs.existsSync(abs)) return `${tag}="/${file}"`; // 外链或构建期还不存在的文件，保持原样
    return `${tag}="/${file}?v=${hashOf(abs)}"`;
  });
  if (BAD_ATTR.test(next)) throw Error('版本号替换产出非法属性，中止写入以免污染源文件');
  return next;
}

const onlinePath = path.join(web, 'online.html');
const online = fingerprint(fs.readFileSync(onlinePath, 'utf8'));
fs.writeFileSync(onlinePath, online);

const out = path.join(web, 'index.html');
fs.writeFileSync(out, online);
console.log('generated web/index.html from online.html (' + fs.statSync(out).size + ' bytes)');

for (const name of ['live.html', 'radio.html']) {
  const p = path.join(web, name);
  const next = fingerprint(fs.readFileSync(p, 'utf8'));
  if (next !== fs.readFileSync(p, 'utf8')) {
    fs.writeFileSync(p, next);
    console.log('fingerprinted ' + name);
  }
}
