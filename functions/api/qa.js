// GET /api/qa?id=논문번호 : 그 논문에 했던 질문과 답 (오래된 순)
// DELETE /api/qa?n=번호 : 질문 하나 지우기
import { json, authed, deny } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return deny();
  const id = new URL(request.url).searchParams.get("id") || "";
  const rows = (await env.DB.prepare("SELECT n, q, a, model, ts FROM qa WHERE id = ? ORDER BY n").bind(id).all()).results;
  return json({ qa: rows });
}

export async function onRequestDelete({ request, env }) {
  if (!authed(request, env)) return deny();
  const n = Number(new URL(request.url).searchParams.get("n"));
  if (!Number.isInteger(n)) return json({ error: "번호가 없습니다" }, 400);
  await env.DB.prepare("DELETE FROM qa WHERE n = ?").bind(n).run();
  return json({ ok: true });
}
