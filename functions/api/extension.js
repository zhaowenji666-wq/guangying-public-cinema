import { json } from '../_lib/cinema.js';
export function onRequest() {
  return json({ ok: true, version: 3, runtime: 'pages' });
}
