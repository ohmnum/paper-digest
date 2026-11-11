// Cloudflare Workers 입구. 화면 파일(docs/)은 Cloudflare 가 그대로 보여 주고, /api/* 요청만 여기로 온다.
// 각 기능은 functions/api/*.js 에 있다. 데이터베이스 표는 첫 요청 때 없으면 자동으로 만든다 (schema.sql 을 따로 실행할 필요 없음).
import * as auth from "./functions/api/auth.js";
import * as state from "./functions/api/state.js";
import * as rec from "./functions/api/rec.js";
import * as qa from "./functions/api/qa.js";
import * as notes from "./functions/api/notes.js";
import * as ask from "./functions/api/ask.js";
import { json } from "./functions/api/_lib.js";

const ROUTES = { auth, state, rec, qa, notes, ask };
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS rec (id TEXT PRIMARY KEY, memo TEXT, star INTEGER DEFAULT 0, read INTEGER DEFAULT 0, ts INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS qa (n INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, q TEXT NOT NULL, a TEXT NOT NULL, model TEXT, ts INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS qa_id ON qa (id)",
  "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT, body TEXT, ts INTEGER NOT NULL)",
];
let ready = null;   // 같은 실행 인스턴스 안에서는 표 만들기를 한 번만

// 다른 주소에서 열린 화면(GitHub Pages: hyeongminkim.com/paper-digest, ohmnum.github.io)도 이 서버를 부를 수 있게 허용한다 (CORS).
// 허용 목록에 없는 출처에는 머리글을 붙이지 않아 브라우저가 막는다. 관리 키는 여전히 머리글 x-key 로 확인한다.
const ORIGINS = new Set(["https://www.hyeongminkim.com", "https://hyeongminkim.com", "https://ohmnum.github.io"]);
function cors(request, res) {
  const o = request.headers.get("origin") || "";
  if (!ORIGINS.has(o)) return res;
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", o);
  h.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  h.set("access-control-allow-headers", "content-type, x-key");
  h.set("access-control-max-age", "86400");
  h.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (!m) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return cors(request, new Response(null, { status: 204 }));
    const mod = ROUTES[m[1]];
    const fn = mod && mod["onRequest" + request.method[0] + request.method.slice(1).toLowerCase()];
    if (!fn) return cors(request, json({ error: "없는 주소" }, 404));
    if (env.DB) {
      try { ready = ready || env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); await ready; }
      catch (e) { ready = null; return cors(request, json({ error: "데이터베이스 준비 실패: " + e.message }, 500)); }
    }
    return cors(request, await fn({ request, env, ctx }));
  },
};
