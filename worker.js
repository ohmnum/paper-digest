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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
    if (!m) return env.ASSETS.fetch(request);
    const mod = ROUTES[m[1]];
    const fn = mod && mod["onRequest" + request.method[0] + request.method.slice(1).toLowerCase()];
    if (!fn) return json({ error: "없는 주소" }, 404);
    if (env.DB) {
      try { ready = ready || env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))); await ready; }
      catch (e) { ready = null; return json({ error: "데이터베이스 준비 실패: " + e.message }, 500); }
    }
    return fn({ request, env, ctx });
  },
};
