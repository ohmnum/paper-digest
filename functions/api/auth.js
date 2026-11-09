// GET /api/auth : 관리 키가 맞는지 확인 + 질문 기능이 켜져 있는지
import { json, authed, deny } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return deny();
  return json({ ok: true, ask: !!env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-2.5-flash", db: !!env.DB });
}
