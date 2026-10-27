// 生成 Pages 入口文件。
// Cloudflare Pages 会自动把 /online.html 重定向到 /online，若在 _redirects 里再写
// "/ -> /online.html" 就会与这个规则形成 308 死循环，所以改为直接产出 index.html。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(base, 'web', 'online.html');
const out = path.join(base, 'web', 'index.html');

fs.copyFileSync(src, out);
console.log('generated web/index.html from online.html (' + fs.statSync(out).size + ' bytes)');
