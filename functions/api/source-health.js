import { sources, json } from '../_lib/cinema.js';
// 前端只启用 enabled===true 的片源，缺这个接口会被过滤成空列表导致搜不到影片
export function onRequest() {
  return json({
    at: Date.now(),
    auditing: false,
    disabled: 0,
    sources: Object.fromEntries(sources.map(s => [s.id, { name: s.name, enabled: true }])),
  });
}
