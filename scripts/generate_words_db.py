#!/usr/bin/env python3
"""
EveryFive DB words 테이블 단어 생성기 (Codex bridge 경유)

Usage:
  python scripts/generate_words_db.py --dry-run
  python scripts/generate_words_db.py --target 1500 --batch-size 25
  python scripts/generate_words_db.py --difficulty 1 --count 50
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
AI_WORKPLACE_DIR = Path("C:/AI_WORKPLACE")
CODEX_DIR = AI_WORKPLACE_DIR / ".codex"

SUPABASE_URL = "https://qftncrkvsergtyhilzwa.supabase.co"
VALID_CATEGORIES = {
    "noun", "verb", "adjective", "adverb",
    "academic", "business", "daily", "nature", "body"
}

# difficulty별 category 분배 가이드
DIFFICULTY_CATEGORY_GUIDE = {
    1: ["noun", "verb", "adjective", "daily", "nature", "body"],
    2: ["noun", "verb", "adjective", "adverb", "daily"],
    3: ["noun", "verb", "academic", "business"],
    4: ["verb", "adjective", "academic", "adverb"],
    5: ["verb", "adjective", "academic", "adverb"],
}

DIFFICULTY_DESC = {
    1: "CEFR A1~A2 수준, 초등~중학교 기초 어휘 (apple, run, big, fast)",
    2: "CEFR A2~B1 수준, 중학교 필수 어휘 (achieve, benefit, consider, clearly)",
    3: "CEFR B1~B2 수준, 고등~대학 입문, 학술·비즈니스 기초 (analyze, demonstrate, furthermore)",
    4: "CEFR B2~C1 수준, 대학 학술 어휘 (articulate, contend, elucidate, nuance)",
    5: "CEFR C1~C2 수준, 원어민 고급 어휘 (acrimony, ameliorate, recalcitrant, sanguine)",
}


def load_env() -> dict:
    env_path = APP_DIR / ".env.local"
    env = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


def get_existing_words(service_key: str) -> tuple[set, dict]:
    """Supabase REST API로 기존 단어 목록을 가져옴. dict: difficulty → set(word)"""
    import urllib.request
    url = f"{SUPABASE_URL}/rest/v1/words?select=word,difficulty&limit=2000"
    req = urllib.request.Request(url, headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            all_words = {row["word"].lower() for row in data}
            by_diff: dict = {}
            for row in data:
                d = row.get("difficulty", 0)
                by_diff.setdefault(d, set()).add(row["word"].lower())
            print(f"  기존 단어 {len(all_words)}개 로드 완료")
            return all_words, by_diff
    except Exception as e:
        print(f"  [WARN] 기존 단어 로드 실패: {e}", file=sys.stderr)
        return set(), {}


def insert_words(words: list, service_key: str) -> int:
    """Supabase REST API로 단어 INSERT"""
    import urllib.request
    if not words:
        return 0

    url = f"{SUPABASE_URL}/rest/v1/words"
    body = json.dumps(words).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal,resolution=ignore-duplicates",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return len(words)
    except Exception as e:
        try:
            body_text = e.read().decode() if hasattr(e, "read") else str(e)
        except Exception:
            body_text = str(e)
        print(f"  [ERROR] INSERT 실패: {body_text[:200]}", file=sys.stderr)
        return 0



# 배치 인덱스별 micro-category 테마 (반복 방지)
MICRO_THEMES = {
    1: [
        "household objects and furniture (소파, 의자, 냉장고 등 생활용품)",
        "food, drink, and cooking verbs (재료, 요리 동작)",
        "clothing and shopping words",
        "transport and travel words (탑승, 이동 관련)",
        "basic emotions and feelings adjectives",
        "school and learning words (교실, 과목 등)",
        "simple nature and weather words",
        "body parts and health basics",
    ],
    2: [
        "phrasal verbs for daily life (give up, run into, look forward to 등)",
        "work and office vocabulary (deadline, schedule, client 등)",
        "social relationship and communication words",
        "money and finance basics (afford, budget, invest 등)",
        "health and medical intermediate words",
        "environment and ecology words",
        "media and technology words (subscribe, update, download 등)",
        "sports and fitness vocabulary",
    ],
    3: [
        "academic verbs for writing and research (elaborate, substantiate, refute 등)",
        "business and economics terms (recession, incentive, subsidiary 등)",
        "phrasal verbs in formal contexts (build upon, draw upon, account for 등)",
        "social science vocabulary (demography, inequality, governance)",
        "science and technology academic words (hypothesis, variable, simulate)",
        "legal and administrative vocabulary (comply, regulate, enforce)",
        "psychology and behavior words (cognitive, stimulus, reinforce)",
        "discourse markers and transition words (moreover, consequently, whereas)",
    ],
    4: [
        "rare academic adjectives and adverbs (perspicacious, inexorable, taciturn)",
        "literary and rhetorical devices vocabulary",
        "advanced business/finance terms (arbitrage, amortize, fiduciary)",
        "philosophy and ethics words (utilitarian, epistemology, dialectic)",
        "uncommon verbs for nuanced expression (exacerbate, mitigate, juxtapose)",
        "advanced collocations as phrasal units (bear the brunt, run the gamut)",
        "political science and policy vocabulary",
        "formal adjectives rarely seen in B1/B2 (ubiquitous, pervasive, inherent)",
    ],
    5: [
        "archaic or literary words in modern use (parlance, abeyance, erstwhile)",
        "rare but useful nouns (turpitude, ennui, equanimity, hubris)",
        "sophisticated verbs (eviscerate, obfuscate, prevaricate, vitiate)",
        "rare adjectives (laconic, meretricious, pellucid, truculent)",
        "academic nominalizations (reification, commodification, praxis)",
        "rhetoric and argumentation terms (sophistry, specious, tendentious)",
        "advanced words from medicine/law/science crossover (iatrogenic, injunction, quantum)",
        "uncommon adverbs (ostensibly, surreptitiously, perfunctorily)",
    ],
}

def build_prompt(difficulty: int, categories: list, count: int, existing_words: set, batch_idx: int,
                 diff_words: set | None = None) -> str:
    # 전체 기존 단어를 알파벳 구간별로 샘플링 → Codex에게 넓은 범위 인식
    import random
    all_sorted = sorted(existing_words)
    n = len(all_sorted)
    # 400개 균등 샘플 (전체 커버)
    if n > 400:
        step = n / 400
        sampled = [all_sorted[int(i * step)] for i in range(400)]
    else:
        sampled = all_sorted
    excluded = ", ".join(sampled)

    # 배치별 micro-theme으로 다양성 확보
    themes = MICRO_THEMES.get(difficulty, [])
    theme = themes[batch_idx % len(themes)] if themes else "general useful vocabulary"

    diff_desc = DIFFICULTY_DESC[difficulty]

    return f"""[역할] 영어 단어 학습 앱 EveryFive의 단어 생성기.
정확히 {count}개의 단어를 JSON 배열로 생성한다.

[핵심 지시]
이미 존재하는 단어들을 절대 생성하지 마라. 아래 "제외 목록"의 단어들은 이미 DB에 있으므로 생성 금지.
이번 배치의 테마: **{theme}**
→ 이 테마에 맞는 단어를 생성해야 한다. 테마에서 벗어나지 마라.
→ 기초적이고 누구나 아는 단어(the 1000 most common English words)는 생성하지 마라.

[조건]
- difficulty: {difficulty} ({diff_desc})
- 한국인 학습자에게 유용하나 잘 모르는 단어 (비기초 어휘)
- 제외 목록에 없는 단어만 생성

[제외 목록 — 이 단어들은 이미 존재함, 절대 생성 금지]
{excluded}

[출력 스키마] 정확히 {count}개:
[
  {{
    "word": "영어단어 또는 phrasal verb",
    "definition_ko": "한국어 뜻 (간결하게)",
    "definition_en": "English definition (1 sentence)",
    "example_sentence": "Example sentence using the word.",
    "difficulty": {difficulty},
    "category": "noun|verb|adjective|adverb|academic|business|daily|nature|body 중 하나"
  }}
]

[제약]
- word: 소문자, 제외 목록에 없는 것만
- difficulty: 반드시 {difficulty}
- 테마에서 벗어난 단어 금지
- definition_ko: 20자 이내
- example_sentence: 단어가 포함된 자연스러운 영문 문장

[출력] JSON 배열만 출력. ```json ... ``` 감싸기. 마지막 줄 ===CODEX_DONE===
"""


def send_via_codex(prompt_text: str, batch_idx: int, difficulty: int, timeout: int = 300) -> list | None:
    sys.path.insert(0, str(AI_WORKPLACE_DIR))
    try:
        from scripts.codex_bridge import send_prompt  # type: ignore
    except ImportError:
        print("  [ERROR] codex_bridge 로드 실패. Codex 탭이 열려 있는지 확인하세요.", file=sys.stderr)
        return None

    CODEX_DIR.mkdir(parents=True, exist_ok=True)
    prompt_file = CODEX_DIR / f"prompt_words_d{difficulty}_b{batch_idx:02d}.txt"
    result_file = CODEX_DIR / f"result_words_d{difficulty}_b{batch_idx:02d}.json"

    prompt_file.write_text(prompt_text, encoding="utf-8")

    instruction = (
        f"'{prompt_file}' 파일을 읽고 지시대로 단어 JSON 배열을 응답에 직접 출력해. "
        f"파일 저장 금지. 마지막 줄에 ===CODEX_DONE=== 추가."
    )
    result = send_prompt(instruction, save_to=str(result_file), timeout=timeout)

    if not result:
        print(f"  [WARN] Codex 응답 없음 (배치 {batch_idx})", file=sys.stderr)
        return None

    content = result
    if "===CODEX_DONE===" in content:
        content = content[: content.rfind("===CODEX_DONE===")]
    match = re.search(r"```json\s*([\s\S]*?)\s*```", content)
    if match:
        content = match.group(1)

    try:
        parsed = json.loads(content.strip())
        if isinstance(parsed, list):
            return parsed
        print(f"  [WARN] 배치 {batch_idx}: 리스트가 아님", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"  [WARN] 배치 {batch_idx} JSON 파싱 실패: {e}", file=sys.stderr)
        return None


def validate_word(word: dict) -> list[str]:
    errors = []
    for field in ("word", "definition_ko", "difficulty", "category"):
        if field not in word or not word[field]:
            errors.append(f"missing: {field}")
    if "category" in word and word["category"] not in VALID_CATEGORIES:
        errors.append(f"invalid category: {word['category']}")
    if "difficulty" in word and word["difficulty"] not in range(1, 6):
        errors.append(f"invalid difficulty: {word['difficulty']}")
    if "word" in word and len(word["word"]) > 60:
        errors.append("word too long")
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--target", type=int, default=1500)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--difficulty", type=int, choices=[1,2,3,4,5], help="특정 difficulty만 생성")
    parser.add_argument("--count", type=int, help="--difficulty와 함께 사용: 해당 difficulty 추가 수")
    args = parser.parse_args()

    env = load_env()
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not service_key:
        print("ERROR: SUPABASE_SERVICE_ROLE_KEY 없음. .env.local 확인.", file=sys.stderr)
        sys.exit(1)

    print("기존 단어 로드 중...")
    existing_words, words_by_diff = get_existing_words(service_key)
    current_count = len(existing_words)

    # 생성 계획 결정
    if args.difficulty and args.count:
        # 특정 difficulty 지정 모드
        plan = [(args.difficulty, args.count)]
    else:
        # 전체 균등 분배 모드
        needed_total = max(0, args.target - current_count)
        if needed_total == 0:
            print(f"이미 목표 달성 ({current_count}개). 종료.")
            return
        per_diff = needed_total // 5
        remainder = needed_total % 5
        plan = [(d, per_diff + (1 if d <= remainder else 0)) for d in range(1, 6)]

    total_needed = sum(c for _, c in plan)
    print(f"\n현재: {current_count}개 | 목표: {args.target}개 | 추가 생성: {total_needed}개")
    print(f"배치 크기: {args.batch_size}개\n")

    for diff, count in plan:
        if count <= 0:
            continue
        cats = DIFFICULTY_CATEGORY_GUIDE.get(diff, list(VALID_CATEGORIES))
        batches = (count + args.batch_size - 1) // args.batch_size
        print(f"── Difficulty {diff}: {count}개 ({batches}배치) ──")

        if args.dry_run:
            print(f"   [DRY-RUN] categories={cats}")
            continue

        diff_added = 0
        for b in range(batches):
            remaining = count - diff_added
            if remaining <= 0:
                break
            size = min(args.batch_size, remaining)
            print(f"  배치 {b+1}/{batches}: {size}개 생성 중...", end=" ", flush=True)

            # difficulty별 기존 단어를 제외 목록으로 전달 → Codex 중복 방지
            diff_words = words_by_diff.get(diff, set())
            prompt = build_prompt(diff, cats, size, existing_words, b, diff_words=diff_words)
            result = send_via_codex(prompt, b, diff)

            if result is None:
                print("SKIP (Codex 실패)")
                continue

            valid_words = []
            for w in result:
                # difficulty 강제 적용
                w["difficulty"] = diff
                errs = validate_word(w)
                word_lower = str(w.get("word", "")).lower()
                if errs:
                    continue
                if word_lower in existing_words:
                    continue
                valid_words.append({
                    "word": w["word"].lower().strip(),
                    "definition_ko": str(w.get("definition_ko", ""))[:50],
                    "definition_en": str(w.get("definition_en", ""))[:200],
                    "example_sentence": str(w.get("example_sentence", ""))[:300],
                    "difficulty": diff,
                    "category": w["category"],
                })
                existing_words.add(word_lower)
                words_by_diff.setdefault(diff, set()).add(word_lower)

            inserted = insert_words(valid_words, service_key)
            diff_added += inserted
            print(f"✓ {inserted}개 삽입 (누적: {diff_added}/{count})")
            time.sleep(2)  # rate limit 방지

    print(f"\n완료. 현재 총 단어: {current_count + total_needed}개 (예상)")


if __name__ == "__main__":
    main()
