// POST /api/ask : {id, question, ctx:{title, title_ko, tldr, bullets, abstract, url}} → Gemini 답을 저장하고 돌려준다.
// 본문은 Gemini 가 직접 읽게 한다 (url_context 도구: arXiv HTML 본문 주소를 넘김). 이 서버에서 본문을 내려받아 자르지 않아서
// Cloudflare 무료 요금제의 CPU 시간 제한에 걸리지 않는다. 도구를 못 쓰는 모델이면 초록·요약만으로 답한다.
// 내 메모는 보내지 않는다 (Gemini 무료 등급은 입력이 Google 제품 개선에 쓰일 수 있음).
import { json, authed, deny } from "./_lib.js";

const SYS = `당신은 ML 논문을 같이 읽어 주는 연구 조교입니다. 사용자는 ML 배경이 깊지 않은 연구자입니다.
- 한국어로, 쉬운 말로 답합니다. 전문 용어는 처음 나올 때 한 줄로 풀어 줍니다.
- 논문 본문에 근거해 답하고, 근거가 된 절·표·그림을 짧게 밝힙니다 (예: "3.2절", "표 2").
- 논문에 없는 내용은 "논문에 나오지 않음"이라고 말하고, 일반 지식으로 보충할 때는 그렇다고 밝힙니다. 숫자를 지어내지 않습니다.
- 본론부터, 필요하면 불릿으로 짧게.`;

const ARXIV = /^\d{4}\.\d{4,5}$/;

async function gemini(env, contents, useTool) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const body = {
    systemInstruction: { parts: [{ text: SYS + (env.ASK_CONTEXT ? "\n\n사용자 배경: " + env.ASK_CONTEXT : "") }] },
    contents,
    generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
  };
  if (useTool) body.tools = [{ url_context: {} }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: (j.error && j.error.message) || "Gemini 오류 " + r.status, status: r.status };
  const c = (j.candidates || [])[0] || {};
  const text = ((c.content && c.content.parts) || []).map(p => p.text || "").join("").trim();
  if (!text) return { error: "빈 답 (" + (c.finishReason || (j.promptFeedback && j.promptFeedback.blockReason) || "이유 모름") + ")", status: 502 };
  return { text, model };
}

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return deny();
  if (!env.GEMINI_API_KEY) return json({ error: "서버에 GEMINI_API_KEY 가 없습니다 (CLOUDFLARE.md 3단계)" }, 500);
  const x = await request.json().catch(() => null);
  const id = x && typeof x.id === "string" ? x.id : "";
  const question = x && typeof x.question === "string" ? x.question.trim().slice(0, 4000) : "";
  if (!id || !question) return json({ error: "논문 번호나 질문이 비어 있습니다" }, 400);
  const ctx = (x && x.ctx) || {};

  const src = ARXIV.test(id) ? `https://arxiv.org/html/${id}` : (typeof ctx.url === "string" ? ctx.url : "");
  const paper = [
    `논문: ${ctx.title || id}` + (ctx.title_ko ? ` (${ctx.title_ko})` : ""),
    src ? `본문 주소: ${src}` + (ARXIV.test(id) ? ` (HTML 판이 없으면 https://arxiv.org/abs/${id})` : "") : "",
    ctx.tldr ? `한 줄 요약: ${ctx.tldr}` : "",
    Array.isArray(ctx.bullets) && ctx.bullets.length ? "요약 불릿:\n- " + ctx.bullets.join("\n- ") : "",
    ctx.abstract ? `초록: ${ctx.abstract}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 20000);

  const hist = (await env.DB.prepare("SELECT q, a FROM qa WHERE id = ? ORDER BY n DESC LIMIT 6").bind(id).all()).results.reverse();
  const contents = [
    { role: "user", parts: [{ text: paper + "\n\n위 본문 주소의 논문을 읽고 이어지는 질문에 답해 주세요." }] },
    { role: "model", parts: [{ text: "논문을 읽었습니다. 질문해 주세요." }] },
  ];
  for (const h of hist) contents.push({ role: "user", parts: [{ text: h.q }] }, { role: "model", parts: [{ text: h.a }] });
  contents.push({ role: "user", parts: [{ text: question }] });

  let out = await gemini(env, contents, !!src);
  if (out.error && src && out.status === 400) out = await gemini(env, contents, false); // 도구를 못 쓰는 모델
  if (out.error) return json({ error: out.error }, out.status === 429 ? 429 : 502);

  const ts = Date.now();
  const res = await env.DB.prepare("INSERT INTO qa (id, q, a, model, ts) VALUES (?, ?, ?, ?, ?) RETURNING n")
    .bind(id, question, out.text, out.model, ts).first();
  return json({ n: res && res.n, q: question, a: out.text, model: out.model, ts });
}
