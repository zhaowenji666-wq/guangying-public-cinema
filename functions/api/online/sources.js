import { sources, json } from '../../_lib/cinema.js';
export function onRequest() {
  return json({ sources: sources.map(({ id, name }) => ({ id, name })), project: 'LunaTV-config + DecoTV' });
}
