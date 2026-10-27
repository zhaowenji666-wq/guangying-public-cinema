import { sources } from '../_sources.js';
import { health } from '../_health.js';
import { json } from '../_lib/cinema.js';

// 返回真实体检结果。前端只启用 enabled=true 的片源，
// 这样坏源不会出现在搜索里，也不会拖慢并发搜索。
export function onRequest() {
  const map = health.sources || {};
  const merged = {};
  for (const s of sources) {
    const h = map[s.id];
    merged[s.id] = h
      ? { name: h.name || s.name, enabled: !!h.enabled, ms: h.ms || 0, reason: h.reason || '', mediaChecked: true }
      : { name: s.name, enabled: true, ms: 0, reason: '未体检', mediaChecked: false };
  }
  const disabled = Object.values(merged).filter(s => !s.enabled).length;
  return json({ at: health.at, auditing: false, disabled, query: health.query, sources: merged });
}
