#!/usr/bin/env python3
"""
add_words_v2.py — 카테고리 지정 단어 추가 스크립트 (v2.0)

Usage:
  python scripts/add_words_v2.py --category business_meeting --count 250 --difficulty 2
  python scripts/add_words_v2.py --category toeic --count 400 --difficulty 2 --dry-run
  python scripts/add_words_v2.py --category industry_it --count 334 --difficulty 3

Arguments:
  --category  : business_meeting | business_email | business_negotiation |
                business_presentation | toeic | cefr_b1 | cefr_b2 |
                industry_it | industry_finance | industry_marketing
  --count     : 추가할 단어 수 (기본값 100)
  --difficulty: 1~5 (기본값 2)
  --dry-run   : DB 실제 쓰기 없이 생성 결과만 출력
  --env       : .env 파일 경로 (기본값 .env.local, 상위 디렉터리 기준)
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
import uuid
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
AI_WORKPLACE_DIR = Path("C:/AI_WORKPLACE")
CODEX_DIR = AI_WORKPLACE_DIR / ".codex"

VALID_CATEGORIES = [
    "business_meeting", "business_email", "business_negotiation", "business_presentation",
    "toeic", "cefr_b1", "cefr_b2",
    "industry_it", "industry_finance", "industry_marketing",
]

CATEGORY_PROMPTS: dict[str, str] = {
    "business_meeting":       "비즈니스 회의·미팅에서 자주 쓰는 영어 단어",
    "business_email":         "비즈니스 이메일 작성에 자주 쓰는 영어 단어",
    "business_negotiation":   "비즈니스 협상·계약에서 자주 쓰는 영어 단어",
    "business_presentation":  "비즈니스 발표·프레젠테이션에서 자주 쓰는 영어 단어",
    "toeic":         "TOEIC 시험 핵심 어휘",
    "cefr_b1":       "CEFR B1 수준 일반 영어 어휘 (일상·업무 기초)",
    "cefr_b2":       "CEFR B2 수준 중상급 영어 어휘 (학술·업무 응용)",
    "industry_it":        "IT·소프트웨어·테크 산업 영어 전문 어휘",
    "industry_finance":   "금융·투자·회계 산업 영어 전문 어휘",
    "industry_marketing": "마케팅·광고·브랜딩 산업 영어 전문 어휘",
}

DIFFICULTY_DESC: dict[int, str] = {
    1: "CEFR A1-A2 초급",
    2: "CEFR A2-B1 중초급",
    3: "CEFR B1-B2 중급",
    4: "CEFR B2-C1 중상급",
    5: "CEFR C1-C2 고급",
}


def load_env(env_path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    p = Path(env_path)
    if not p.exists():
        return env
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def fetch_existing_words(supabase_url: str, service_key: str, category: str) -> set[str]:
    url = f"{supabase_url}/rest/v1/words?select=word&category=eq.{category}&limit=5000"
    req = urllib.request.Request(url, headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            words = {row["word"].lower() for row in data}
            print(f"  기존 '{category}' 단어: {len(words)}개")
            return words
    except Exception as e:
        print(f"  [WARN] 기존 단어 로드 실패: {e}", file=sys.stderr)
        return set()


def insert_words_batch(words: list[dict], supabase_url: str, service_key: str) -> int:
    if not words:
        return 0
    url = f"{supabase_url}/rest/v1/words"
    body = json.dumps(words).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return len(words)
    except Exception as e:
        try:
            body_text = e.read().decode() if hasattr(e, "read") else str(e)
        except Exception:
            body_text = str(e)
        print(f"  [ERROR] INSERT 실패: {body_text[:300]}", file=sys.stderr)
        return 0


def generate_via_codex(category: str, count: int, difficulty: int, existing: set[str]) -> list[dict]:
    """Codex bridge(send_prompt)를 경유해 AI 단어 생성"""
    sys.path.insert(0, str(AI_WORKPLACE_DIR))
    try:
        from scripts.codex_bridge import send_prompt
    except ImportError:
        print("[WARN] Codex bridge 로드 실패 — 빈 결과 반환", file=sys.stderr)
        return []

    category_desc = CATEGORY_PROMPTS.get(category, category)
    difficulty_desc = DIFFICULTY_DESC.get(difficulty, f"difficulty {difficulty}")
    existing_sample = ", ".join(list(existing)[:20]) if existing else "없음"

    prompt = f"""당신은 영어 교육 전문가입니다.
아래 조건에 맞는 영어 단어 {count}개를 JSON 배열로 생성해주세요.

조건:
- 카테고리: {category_desc}
- 난이도: {difficulty_desc}
- 이미 존재하는 단어 (추가 금지): {existing_sample}
- 중복 단어 생성 금지

각 단어는 다음 JSON 형식으로 반환:
{{
  "word": "영어 단어 (소문자 기본형)",
  "definition_ko": "한국어 뜻 (15자 이내, 간결하게)",
  "definition_en": "English definition (1 sentence)",
  "example_sentence": "Example sentence in English using the word",
  "example_sentence_ko": "위 예문의 한국어 번역",
  "difficulty": {difficulty},
  "category": "{category}"
}}

반드시 유효한 JSON 배열만 출력하세요. 설명 텍스트 없이 [ 로 시작해서 ] 로 끝내세요.
"""

    prompt_file = CODEX_DIR / f"prompt_words_{category}.txt"
    result_file = CODEX_DIR / f"result_words_{category}.txt"
    CODEX_DIR.mkdir(parents=True, exist_ok=True)
    prompt_file.write_text(prompt, encoding="utf-8")

    instruction = (
        f"'{prompt_file}' 파일을 읽고 지시대로 영어 단어 JSON 배열을 생성한 뒤 "
        f"결과를 '{result_file}'에 저장하고 마지막 줄에 ===CODEX_DONE=== 추가해줘"
    )

    print(f"  Codex에 {count}개 단어 생성 요청 중... (timeout: 300s)")
    result = send_prompt(instruction, save_to=str(result_file), timeout=300)

    try:
        match = re.search(r'\[.*\]', result, re.DOTALL)
        if not match:
            print(f"  [ERROR] JSON 배열 파싱 실패. 결과: {result[:200]}", file=sys.stderr)
            return []
        return [w for w in json.loads(match.group()) if isinstance(w, dict) and "word" in w]
    except json.JSONDecodeError as e:
        print(f"  [ERROR] JSON 파싱 실패: {e}", file=sys.stderr)
        return []


def deduplicate(words: list[dict], existing: set[str]) -> list[dict]:
    seen = set(existing)
    result = []
    for w in words:
        key = w.get("word", "").lower()
        if key and key not in seen:
            seen.add(key)
            if "word_id" not in w:
                w["word_id"] = str(uuid.uuid4())
            result.append(w)
    return result


def main():
    parser = argparse.ArgumentParser(description="카테고리 지정 단어 추가 (Codex bridge 경유)")
    parser.add_argument("--category", required=True, choices=VALID_CATEGORIES,
                        help=f"단어 카테고리: {', '.join(VALID_CATEGORIES)}")
    parser.add_argument("--count", type=int, default=100, help="추가할 단어 수 (기본값 100)")
    parser.add_argument("--difficulty", type=int, default=2, choices=range(1, 6),
                        help="난이도 1~5 (기본값 2)")
    parser.add_argument("--dry-run", action="store_true", help="DB INSERT 없이 생성 결과만 확인")
    parser.add_argument("--env", default=None, help=".env 파일 경로 (기본값: 프로젝트 루트/.env.local)")
    args = parser.parse_args()

    env_path = args.env or str(APP_DIR / ".env.local")
    env = load_env(env_path)
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_key:
        print("[ERROR] NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.", file=sys.stderr)
        sys.exit(1)

    print(f"\n=== add_words_v2.py ===")
    print(f"카테고리: {args.category} | 목표: {args.count}개 | 난이도: {DIFFICULTY_DESC.get(args.difficulty)} | dry-run: {args.dry_run}")

    print("\n[1] 기존 단어 로드...")
    existing = fetch_existing_words(supabase_url, service_key, args.category) if not args.dry_run else set()

    print(f"\n[2] Codex로 {args.count}개 단어 생성 중...")
    words = generate_via_codex(args.category, args.count, args.difficulty, existing)
    if not words:
        print("  [WARN] Codex 생성 결과 없음. 종료합니다.")
        sys.exit(1)
    print(f"  생성된 단어: {len(words)}개")

    words = deduplicate(words, existing)
    print(f"  중복 제거 후: {len(words)}개")

    if args.dry_run:
        print(f"\n[dry-run] INSERT 대상 {len(words)}개 단어 (상위 5개):")
        for w in words[:5]:
            print(f"  - {w.get('word')}: {w.get('definition_ko')}")
        if len(words) > 5:
            print(f"  ... 및 {len(words) - 5}개 추가")
        print("\n[dry-run] 완료 (INSERT 없음)")
        return

    print(f"\n[3] Supabase INSERT 중... (50개 배치)")
    total = 0
    for i in range(0, len(words), 50):
        batch = words[i:i + 50]
        n = insert_words_batch(batch, supabase_url, service_key)
        total += n
        print(f"  배치 {i // 50 + 1}: {n}개 INSERT")
        time.sleep(0.3)

    print(f"\n=== 완료: {total}개 단어 추가 ({args.category}) ===")


if __name__ == "__main__":
    main()
