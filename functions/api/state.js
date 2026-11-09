// GET /api/state : 메모·★·읽음 기록, 노트 목록, 논문별 질문 수 (관리 키 필요 — 메모는 공개하지 않는다)
import { json, authed, deny } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return deny();
  const rec = {};
  for (const r of (await env.DB.prepare("SELECT id, memo, star, read, ts FROM rec").all()).results)
    rec[r.id] = { memo: r.memo || "", star: !!r.star, read: !!r.read, ts: r.ts };
  const notes = (await env.DB.prepare("SELECT id, title, substr(body, 1, 200) AS preview, length(body) AS n, ts FROM notes ORDER BY ts DESC").all()).results;
  const qa = {};
  for (const r of (await env.DB.prepare("SELECT id, count(*) AS n FROM qa GROUP BY id").all()).results) qa[r.id] = r.n;
  return json({ rec, notes, qa });
}
