// PUT /api/rec : [{id, memo, star, read, ts}, ...] 저장. 서버에 더 새 기록(ts 가 큼)이 있으면 그 논문은 건너뛴다.
import { json, authed, deny } from "./_lib.js";

export async function onRequestPut({ request, env }) {
  if (!authed(request, env)) return deny();
  let items = await request.json().catch(() => null);
  if (!Array.isArray(items)) items = items ? [items] : [];
  items = items.filter(x => x && typeof x.id === "string" && x.id && x.id.length < 200 && Number.isFinite(x.ts));
  if (!items.length) return json({ saved: 0 });
  const st = env.DB.prepare(
    `INSERT INTO rec (id, memo, star, read, ts) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET memo = excluded.memo, star = excluded.star, read = excluded.read, ts = excluded.ts
     WHERE excluded.ts > rec.ts`);
  await env.DB.batch(items.map(x => st.bind(x.id, String(x.memo || "").slice(0, 200000), x.star ? 1 : 0, x.read ? 1 : 0, Math.floor(x.ts))));
  return json({ saved: items.length });
}
