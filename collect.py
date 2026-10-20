# -*- coding: utf-8 -*-
"""매일 논문 수집 → Claude 로 관련도 채점 → 상위 논문 한국어 불릿 요약 + 제안방법 그림 → docs/data 저장 → git push.

  python collect.py            # 최근 2일치 (이미 본 논문은 건너뜀)
  python collect.py --days 7   # 처음 채우기
  python collect.py --no-push  # 저장만
출처: arXiv API(키워드 검색) + Hugging Face Daily Papers. 요약은 로컬 Claude CLI(sonnet).
"""
import argparse, datetime as dt, html, json, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
import concurrent.futures as cf
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "docs", "data")
SEEN = os.path.join(ROOT, "seen.json")
CFG = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
UA = {"User-Agent": "paper-digest/1.0 (personal reading list)"}


def get(url, timeout=40, tries=6):
    """429/503(요청 과다) 이면 점점 길게 쉬었다 재시도."""
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace"), r.geturl()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or t == tries - 1:
                raise
            time.sleep(15 * (t + 1))


def claude(prompt, system, model="sonnet"):
    exe = CFG.get("claude_exe") or "claude"
    r = subprocess.run([exe, "-p", "--system-prompt", system, "--tools", "", "--no-session-persistence",
                        "--strict-mcp-config", "--model", model], input=prompt,
                       capture_output=True, text=True, encoding="utf-8", timeout=600)
    return r.stdout.strip()


def js(t, default):
    m = re.search(r"[\[{].*[\]}]", t, re.S)
    try:
        return json.loads(m.group(0)) if m else default
    except Exception:
        return default


# ---------- 1) 수집 ----------
def arxiv_search(days):
    since = dt.datetime.utcnow() - dt.timedelta(days=days)
    terms = " OR ".join(f'abs:"{k}"' for k in CFG["arxiv_keywords"])
    cats = " OR ".join(f"cat:{c}" for c in CFG["arxiv_categories"])
    out = []
    for start in range(0, 6000, 200):
        q = urllib.parse.urlencode({"search_query": f"({cats}) AND ({terms})", "sortBy": "submittedDate",
                                    "sortOrder": "descending", "start": start, "max_results": 200})
        try:
            xml, _ = get("http://export.arxiv.org/api/query?" + q, 90, tries=3)
        except Exception as ex:   # 검색 API 는 자주 429 로 막힌다 → 있는 만큼만
            print("arXiv 검색 API 실패, 건너뜀:", ex, flush=True); break
        ns = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
        entries = ET.fromstring(xml).findall("a:entry", ns)
        stop = False
        for e in entries:
            pub = dt.datetime.strptime(e.find("a:published", ns).text[:19], "%Y-%m-%dT%H:%M:%S")
            if pub < since:
                stop = True; break
            aid = e.find("a:id", ns).text.rsplit("/", 1)[-1]
            out.append({"id": re.sub(r"v\d+$", "", aid), "title": " ".join(e.find("a:title", ns).text.split()),
                        "abstract": " ".join(e.find("a:summary", ns).text.split()),
                        "authors": [a.find("a:name", ns).text for a in e.findall("a:author", ns)],
                        "comment": (e.find("x:comment", ns).text if e.find("x:comment", ns) is not None else "") or "",
                        "published": pub.strftime("%Y-%m-%d"), "source": "arXiv"})
        if stop or len(entries) < 200:
            break
        time.sleep(5)
    return out


def rss_new():
    """arXiv RSS(최근 공지분). 검색 API 보다 덜 막힌다. 키워드로 1차 거름."""
    cats = "+".join(CFG["arxiv_categories"])
    xml, _ = get(f"https://rss.arxiv.org/rss/{cats}", 90)
    ns = {"dc": "http://purl.org/dc/elements/1.1/"}
    kws = [k.lower() for k in CFG["arxiv_keywords"]]
    out = []
    for it in ET.fromstring(xml).iter("item"):
        desc = it.findtext("description") or ""
        if "Announce Type: replace" in desc:
            continue
        title = " ".join((it.findtext("title") or "").split())
        abs_ = " ".join(desc.split("Abstract:", 1)[-1].split())
        hay = (title + " " + abs_).lower()
        if not any(k in hay for k in kws):
            continue
        aid = (it.findtext("link") or "").rsplit("/", 1)[-1]
        pub = it.findtext("pubDate") or ""
        try:
            pub = dt.datetime.strptime(pub[:16], "%a, %d %b %Y").strftime("%Y-%m-%d")
        except Exception:
            pub = dt.date.today().isoformat()
        out.append({"id": aid, "title": title, "abstract": abs_, "comment": "", "published": pub, "source": "arXiv",
                    "authors": [a.strip() for a in (it.findtext("dc:creator", namespaces=ns) or "").split(",") if a.strip()]})
    return out


def hf_daily(days):
    out = []
    for d in range(days):
        day = (dt.date.today() - dt.timedelta(days=d)).isoformat()
        try:
            items = json.loads(get(f"https://huggingface.co/api/daily_papers?date={day}")[0])
        except Exception as ex:
            print("hf", day, ex); continue
        for it in items:
            p = it.get("paper", {})
            out.append({"id": p.get("id"), "title": " ".join((p.get("title") or "").split()),
                        "abstract": " ".join((p.get("summary") or "").split()),
                        "authors": [a.get("name") for a in p.get("authors", [])], "comment": "",
                        "published": (p.get("publishedAt") or day)[:10], "source": "HF Daily",
                        "upvotes": p.get("upvotes", 0)})
    return out


# ---------- 2) 관련도 채점 ----------
SCORE_SYS = """You screen new ML papers for one researcher. Their interests:
{interests}
For each paper give a relevance score 0-10 (10 = directly on their interests, 7 = clearly useful, <=4 = unrelated).
Reply with ONLY a JSON list: [{{"id": "...", "score": n}}]"""


def score(papers):
    sys_p = SCORE_SYS.format(interests=CFG["interests"])
    batches = [papers[i:i + 25] for i in range(0, len(papers), 25)]
    def run(b):
        txt = "\n\n".join(f"id: {p['id']}\ntitle: {p['title']}\nabstract: {p['abstract'][:1200]}" for p in b)
        return js(claude(txt, sys_p), [])
    sc = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for res in ex.map(run, batches):
            for r in res:
                if isinstance(r, dict) and "id" in r:
                    sc[str(r["id"])] = float(r.get("score", 0))
    for p in papers:
        p["score"] = sc.get(p["id"], 0.0)
    return papers


# ---------- 3) 본문·그림 ----------
def arxiv_html(aid):
    """arXiv HTML 판에서 본문 앞부분과 그림(주소·캡션)을 뽑는다. 없으면 (None, [])."""
    try:
        page, final = get(f"https://arxiv.org/html/{aid}")
    except Exception:
        return None, []
    if "ltx_document" not in page:
        return None, []
    base = final if final.endswith("/") else final + "/"
    figs = []
    for m in re.finditer(r'<figure[^>]*class="ltx_figure[^"]*"[^>]*>(.*?)</figure>', page, re.S):
        blk = re.sub(r"<annotation[^>]*>.*?</annotation[^>]*>", "", m.group(1), flags=re.S)
        img = re.search(r'<img[^>]*src="([^"]+)"', blk)
        cap = re.search(r"<figcaption[^>]*>(.*?)</figcaption>", blk, re.S)
        if img:
            capt = html.unescape(re.sub(r"<[^>]+>", " ", cap.group(1))) if cap else ""
            figs.append({"src": urllib.parse.urljoin(base, img.group(1)), "caption": " ".join(capt.split())[:400]})
    body = re.sub(r"<(script|style|annotation|annotation-xml)[^>]*>.*?</\1>", " ", page, flags=re.S)
    body = html.unescape(re.sub(r"<[^>]+>", " ", body))
    body = " ".join(body.split())
    k = body.find("Abstract")
    front = body[:k][-2500:] if k > 0 else body[:2500]
    i = body.find("Introduction")
    head = "[TITLE/AUTHORS BLOCK] " + front + " [END BLOCK] " + body[i if i > 0 else 0:][:9000]
    j = max(body.rfind("Limitation"), body.rfind("Conclusion"))
    tail = body[j:j + 4000] if j > len(head) else ""
    return head + (" ... " + tail if tail else ""), figs[:12]


ARX_LOCK = __import__("threading").Lock()


def arxiv_meta(aid):
    """arXiv 논문 페이지의 Comments / Journal-ref (학회 채택 정보가 주로 여기 있다)."""
    try:
        page, _ = get(f"https://arxiv.org/abs/{aid}", 30, tries=2)
    except Exception:
        return "", ""
    f = lambda c: " ".join(html.unescape(re.sub(r"<[^>]+>", " ", m.group(1))).split()) if (m := re.search(
        rf'<td class="tablecell {c}[^"]*">(.*?)</td>', page, re.S)) else ""
    return f("comments"), f("jref")


SUM_SYS = """You write a Korean reading digest of an ML paper for a researcher with limited ML background.
Researcher interests: {interests}
Reply with ONLY a JSON object:
{{"title_ko": "<논문이 하는 일을 한국어 한 줄로, 20자~45자>",
 "tldr": "<한국어 한 문장 핵심>",
 "bullets": ["문제: ...", "방법: ...", "결과: ...", "한계: ..."],  (각 불릿은 짧은 한 문장, 70자 이내)
 "why": "<이 연구자에게 왜 볼 만한지 한국어 한 문장, 관련 없으면 빈 문자열>",
 "tags": ["<2-4개 짧은 한국어 또는 영어 태그>"],
 "venue": "<comment·본문에서 확인된 학회·저널과 연도(예: ICLR 2026, NeurIPS 2025 Workshop), 없으면 빈 문자열>",
 "affiliations": ["<TITLE/AUTHORS BLOCK 에 적힌 저자 소속 기관, 중복 없이 짧게(예: Stanford University, Google DeepMind), 없으면 빈 리스트>"],
 "fig_ko": "<고른 그림이 무엇을 보여주는지 한국어 한 문장, 없으면 빈 문자열>",
 "fig": <제안 방법 개요/파이프라인을 가장 잘 보여주는 그림 번호(0부터), 적당한 그림 없으면 -1>}}
Rules: plain Korean, define jargon briefly in parentheses, numbers only if stated in the text, never invent results."""


def summarize(p):
    text, figs = arxiv_html(p["id"])
    if not p.get("comment"):
        p["comment"], p["journal_ref"] = arxiv_meta(p["id"])
    figlist = "\n".join(f"[{i}] {f['caption'][:250]}" for i, f in enumerate(figs)) or "(none)"
    prompt = (f"TITLE: {p['title']}\nCOMMENT: {p.get('comment','')}\nJOURNAL_REF: {p.get('journal_ref','')}\nABSTRACT: {p['abstract']}\n\n"
              f"FIGURES:\n{figlist}\n\nBODY (truncated):\n{text or '(no HTML version; use abstract only)'}")
    s = js(claude(prompt, SUM_SYS.format(interests=CFG["interests"])), {})
    fi = s.get("fig", -1) if isinstance(s.get("fig", -1), int) else -1
    fig = figs[fi] if 0 <= fi < len(figs) else None
    return {"id": p["id"], "title": p["title"], "authors": p["authors"][:8], "n_authors": len(p["authors"]),
            "published": p["published"], "source": p["source"], "score": p["score"], "upvotes": p.get("upvotes"),
            "comment": p.get("comment", ""), "abstract": p["abstract"],
            "title_ko": s.get("title_ko", ""), "tldr": s.get("tldr", ""), "bullets": s.get("bullets", []),
            "why": s.get("why", ""), "tags": s.get("tags", []), "venue": s.get("venue", "") or p.get("journal_ref", ""), "affiliations": s.get("affiliations", [])[:8], "figure": fig, "fig_ko": s.get("fig_ko", "") if fig else "",
            "html": bool(text)}


# ---------- 4) 저장 ----------
def save(day, items, backfill=False):
    for it in items:
        it["collected"] = it["published"] if backfill else day
        it["backfill"] = backfill
    for month in sorted({it["collected"][:7] for it in items}):
        path = os.path.join(DATA, f"{month}.json")
        cur = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
        have = {x["id"] for x in cur}
        cur += [it for it in items if it["collected"][:7] == month and it["id"] not in have]
        cur.sort(key=lambda x: (x["collected"], x["score"]), reverse=True)
        json.dump(cur, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    months = sorted({f[:7] for f in os.listdir(DATA) if re.match(r"\d{4}-\d{2}\.json$", f)}, reverse=True)
    json.dump({"months": months, "updated": dt.datetime.now().strftime("%Y-%m-%d %H:%M")},
              open(os.path.join(DATA, "index.json"), "w", encoding="utf-8"), ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=2); ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--max", type=int, default=CFG.get("max_per_day", 12), help="하루 최대 편수")
    ap.add_argument("--backfill", type=int, default=0, help="지난 N일을 관련도순으로 모아 --top 편 (날짜는 공개일 기준)")
    ap.add_argument("--top", type=int, default=100)
    a = ap.parse_args()
    os.makedirs(DATA, exist_ok=True)
    seen = set(json.load(open(SEEN))) if os.path.exists(SEEN) else set()
    pool = {}
    days = a.backfill or a.days
    src = hf_daily(days) + (arxiv_search(days) if a.backfill else rss_new())
    for p in src:
        if p["id"] and p["id"] not in seen and p["abstract"]:
            pool.setdefault(p["id"], p).update({k: v for k, v in p.items() if k == "upvotes"})
    print(f"후보 {len(pool)}편", flush=True)
    papers = score(list(pool.values()))
    keep = sorted([p for p in papers if p["score"] >= CFG.get("min_score", 7)], key=lambda p: -p["score"])
    keep = keep[:a.top] if a.backfill else keep[:a.max]
    print(f"선정 {len(keep)}편", flush=True)
    with cf.ThreadPoolExecutor(4) as ex:
        items = list(ex.map(summarize, keep))
    save(dt.date.today().isoformat(), items, backfill=bool(a.backfill))
    seen |= set(pool)
    json.dump(sorted(seen), open(SEEN, "w"))
    if not a.no_push:
        g = lambda *c: subprocess.run(["git", "-C", ROOT, *c], capture_output=True, text=True)
        g("add", "docs", "seen.json")
        g("commit", "-m", f"digest {dt.date.today().isoformat()}: {len(items)}편")
        print(g("push").stderr[-300:], flush=True)
    print("완료", flush=True)


if __name__ == "__main__":
    main()
