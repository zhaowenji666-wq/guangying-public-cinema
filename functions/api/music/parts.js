import { musicParts } from '../../_lib/music.js';
import { json } from '../../_lib/cinema.js';
export async function onRequest(context) {
  const bvid = new URL(context.request.url).searchParams.get('bvid');
  try {
    return json(await musicParts(bvid));
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
