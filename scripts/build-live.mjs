// 生成直播频道模块：live-sources.json -> web/live-channels.js
// Pages 静态资源无法在运行时读 JSON，所以构建期生成 JS 模块。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(fs.readFileSync(path.join(base, 'live-sources.json'), 'utf8'));
const channels = (raw.channels || []).filter(c => c && c.name && /^https?:\/\//.test(c.url));

const payload = {
  updatedAt: raw.updated_at || '',
  note: raw.note || '',
  channels,
};

fs.writeFileSync(
  path.join(base, 'web', 'live-channels.js'),
  '// 由 scripts/build-live.mjs 从 live-sources.json 生成，请勿手改\n' +
  'window.LIVE_CHANNELS = ' + JSON.stringify(payload) + ';\n'
);

const groups = {};
for (const c of channels) groups[c.group] = (groups[c.group] || 0) + 1;
console.log('live channels ' + channels.length + ' ' + JSON.stringify(groups));
