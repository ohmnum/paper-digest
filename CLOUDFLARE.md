# Cloudflare 로 옮기기 (저장·질문·노트)

GitHub Pages 는 파일만 보여 줄 수 있어서, 메모를 서버에 저장하거나 논문에 질문할 수 없습니다.
Cloudflare Pages 는 같은 파일을 보여 주면서 작은 서버 코드(`functions/api/`)와 데이터베이스(D1)를 같이 돌릴 수 있습니다.
전부 무료 요금제 안에서 됩니다. 아래는 모두 웹 대시보드에서 하는 일이라 PC 에 따로 설치할 것은 없습니다.

## 무엇이 바뀌나
| | 누구나 (방문자) | 관리 키를 넣은 나 |
|---|---|---|
| 논문 목록·요약·검색 | 볼 수 있음 | 볼 수 있음 |
| ★ 보관·✓ 읽음·📝 메모 | 그 브라우저에만 저장 | 서버에 저장 → 모든 기기에서 같음 |
| 💬 논문에 질문 (Gemini) | 안 보임 | 메모 창 아래에서 질문, 답은 서버에 저장, "메모에 붙이기" |
| 📒 노트 (논문에 묶이지 않은 글) | 안 보임 | 쓰기·고치기·지우기 |

- 메모·질문·노트는 관리 키 없이는 서버에서 읽을 수 없습니다 (공개 저장소에 올라가지 않음).
- 질문할 때 Gemini 에 보내는 것: 논문 주소·초록·요약, 그 논문에 앞서 한 질문과 답(최근 6개), 새 질문. **메모와 노트는 보내지 않습니다.**
- Gemini 무료 등급은 보낸 내용이 Google 제품 개선에 쓰일 수 있습니다. 회사 내부 내용은 질문에 넣지 마세요.
- 매일 논문 수집(`collect.py`)은 그대로입니다. GitHub 에 올리면 Cloudflare 가 1~2분 안에 자동으로 새 판을 올립니다.

## 1. 사이트 만들기 (Pages)
1. https://dash.cloudflare.com 가입·로그인
2. 왼쪽 **Workers & Pages** → **Create** → **Pages** 탭 → **Connect to Git** → GitHub 연결 → `ohmnum/paper-digest` 선택
3. 빌드 설정
   - Framework preset: **None**
   - Build command: **비워 둠**
   - Build output directory: **`docs`**
4. **Save and Deploy** → 끝나면 주소가 나옵니다 (예: `https://paper-digest.pages.dev`)

## 2. 데이터베이스 만들기 (D1)
1. 왼쪽 **Storage & Databases** → **D1 SQL Database** → **Create** → 이름 `paper-digest`
2. 만든 데이터베이스 → **Console** 탭 → 이 저장소의 `schema.sql` 내용을 통째로 붙여 넣고 **Execute**
3. **Workers & Pages** → `paper-digest` 프로젝트 → **Settings** → **Bindings** → **Add** → **D1 database**
   - Variable name: **`DB`** (대문자 그대로)
   - D1 database: `paper-digest`

## 3. 비밀값 넣기
같은 프로젝트 → **Settings** → **Variables and Secrets** → **Add** (Type 은 **Secret**)

| 이름 | 값 | 비고 |
|---|---|---|
| `ADMIN_KEY` | 내가 정한 긴 비밀번호 | 쓰기 권한. 아래 명령으로 만들면 편함 |
| `GEMINI_API_KEY` | Google AI Studio 키 | https://aistudio.google.com/apikey → **Create API key** (무료) |
| `GEMINI_MODEL` (선택, Type Text) | 예: `gemini-2.5-flash` | 비우면 `gemini-2.5-flash`. 더 새 Flash 가 있으면 그 이름으로 |
| `ASK_CONTEXT` (선택, Type Text) | 예: "LLM 미세조정 데이터와 행동 교정을 연구함" | 답할 때 참고할 내 배경. 회사 내용은 넣지 말 것 |

관리 키 만들기 (PC 에서): `python -c "import secrets; print(secrets.token_urlsafe(24))"`
키 값은 직접 넣어 주세요. 저(Claude)는 키를 받거나 넣지 않습니다.

## 4. 다시 올리기
**Deployments** 탭 → 맨 위 배포의 **⋯** → **Retry deployment**. (바인딩·비밀값은 다음 배포부터 적용됩니다)

## 5. 쓰기 시작
1. 새 주소를 열고 맨 아래 **관리 키** 칸에 `ADMIN_KEY` 값 → **열기**
   - "질문 기능 켜짐 (gemini-…)" 이 보이면 성공
2. 예전 GitHub 동기화 메모 옮기기: 맨 아래 **가져오기** → PC 의 `paper-digest/old_notes.json` (12편, 메모 2개, 보관 1개. git 에는 안 올라감)
3. 다른 기기(휴대폰 등)에서도 관리 키를 한 번 넣으면 같은 메모가 보입니다. 공용 PC 에서는 다 쓰고 **이 기기에서 잠그기**.

## 문제가 생기면
| 증상 | 원인·해결 |
|---|---|
| "관리 키가 틀림" | `ADMIN_KEY` 를 넣은 뒤 4단계(다시 올리기)를 안 함, 또는 앞뒤 공백 |
| "서버 연결 실패 (500)" + 저장 안 됨 | D1 바인딩 이름이 `DB` 가 아님, 또는 2단계 `schema.sql` 실행 안 함 |
| "질문 기능 꺼짐" | `GEMINI_API_KEY` 없음 → 3단계 후 4단계 |
| 질문 시 "quota"/429 | Gemini 무료 사용량 한도 (분당·하루). 잠시 뒤 다시 |
| 답이 본문을 못 읽은 듯함 | 그 논문에 arXiv HTML 판이 없을 수 있음. 초록·요약만으로 답함 |
| 옛 주소(hyeongminkim.com/paper-digest)에서 관리 키가 안 됨 | 정상. 옛 주소는 GitHub Pages 라 서버가 없음. 새 주소를 쓰세요 |

## 파일
- `functions/api/` — 서버 코드 (auth, state, rec, qa, ask, notes). `_lib.js` 가 관리 키 확인
- `schema.sql` — 데이터베이스 표 3개 (rec = 논문별 메모·★·읽음, qa = 질문과 답, notes = 노트)
- `docs/index.html` — 화면 (방문자/관리자 공용)
