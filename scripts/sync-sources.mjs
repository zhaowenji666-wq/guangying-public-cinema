// 同步片源配置：sources.json + sources.custom.json -> functions/_sources.js
// Cloudflare Pages Functions 无法在运行时读 JSON 文件，所以在部署前生成模块。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = JSON.parse(fs.readFileSync(path.join(base, 'sources.json'), 'utf8')).api_site;
let custom = {};
try { custom = JSON.parse(fs.readFileSync(path.join(base, 'sources.custom.json'), 'utf8')).api_site || {}; } catch {}

const merged = { ...main };
Object.assign(merged, custom);
const arr = Object.entries(merged).filter(([, s]) => !s.adult).map(([id, s]) => ({ id, name: s.name, api: s.api }));

fs.writeFileSync(
  path.join(base, 'functions', '_sources.js'),
  '// 由 scripts/sync-sources.mjs 从 sources.json + sources.custom.json 生成，请勿手改\n' +
  'export const sources = ' + JSON.stringify(arr) + ';\n'
);
console.log('synced ' + arr.length + ' sources (' + Object.keys(custom).length + ' custom)');
