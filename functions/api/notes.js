// 논문에 묶이지 않은 노트 (예: 질문하며 정리한 내용, 실험 정리)
// GET /api/notes?id=노트번호 : 노트 하나 / PUT /api/notes : {id, title, body, ts} 저장 / DELETE /api/notes?id=노트번호
import { json, authed, deny } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return deny();
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await env.DB.prepare("SELECT id, title, body, ts FROM notes WHERE id = ?").bind(id).first();
  return row ? json(row) : json({ error: "없는 노트" }, 404);
}

export async function onRequestPut({ request, env }) {
  if (!authed(request, env)) return deny();
  const x = await request.json().catch(() => null);
  if (!x || typeof x.id !== "string" || !x.id || x.id.length > 100 || !Number.isFinite(x.ts)) return json({ error: "형식이 틀렸습니다" }, 400);
  await env.DB.prepare(
    `INSERT INTO notes (id, title, body, ts) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, ts = excluded.ts WHERE excluded.ts > notes.ts`)
    .bind(x.id, String(x.title || "").slice(0, 300), String(x.body || "").slice(0, 500000), Math.floor(x.ts)).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (!authed(request, env)) return deny();
  const id = new URL(request.url).searchParams.get("id") || "";
  await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
