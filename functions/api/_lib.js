// 공통: 응답 도우미와 쓰기 권한 확인.
// 관리 키(ADMIN_KEY)는 Cloudflare 대시보드의 비밀값으로만 둔다. 브라우저는 요청 머리글 x-key 로 보낸다.
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function authed(request, env) {
  const k = request.headers.get("x-key") || "";
  const want = env.ADMIN_KEY || "";
  if (!want || k.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < k.length; i++) d |= k.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

export const deny = () => json({ error: "관리 키가 없거나 틀렸습니다" }, 401);
