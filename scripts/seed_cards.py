#!/usr/bin/env python3
"""
EveryFive 콘텐츠 시드 스크립트 (Codex bridge 경유)

Assumption A-01 수정: 'cards' Supabase 테이블은 존재하지 않음.
실제 콘텐츠는 everyfive-content/content/v1/words.json 에 저장됨.

Usage:
  python scripts/seed_cards.py --dry-run          # 생성 계획 미리보기 (파일 변경 없음)
  python scripts/seed_cards.py                    # 실제 words.json 업데이트
  python scripts/seed_cards.py --target 500 --batch-size 30
"""

import argparse
import json
import os
import sys
import re
from pathlib import Path
from typing import Optional


SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
CONTENT_WORDS_PATH = APP_DIR.parent / "everyfive-content" / "content" / "v1" / "words.json"
SCHEMA_PATH = APP_DIR.parent / "everyfive-content" / "schemas" / "word.schema.json"
CODEX_DIR = Path("C:/AI_WORKPLACE/.codex")
AI_WORKPLACE_DIR = Path("C:/AI_WORKPLACE")

VALID_CONTEXTS = {"meeting", "lunch", "email", "interview", "presentation"}
VALID_LEVELS = {"A1", "A2", "B1", "B2", "C1", "C2"}
VALID_TRACKS = {"daily", "academic"}


def load_env_local() -> dict:
    env_path = APP_DIR / ".env.local"
    env = {}
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip()
    return env


def load_words() -> list:
    if not CONTENT_WORDS_PATH.exists():
        print(f"ERROR: words.json not found at {CONTENT_WORDS_PATH}", file=sys.stderr)
        sys.exit(1)
    with open(CONTENT_WORDS_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_words(words: list) -> None:
    with open(CONTENT_WORDS_PATH, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)


def validate_word(word: dict) -> list[str]:
    errors = []
    for field in ("word_id", "word", "level", "track", "meaning_ko", "ipa", "phrasal_verbs", "scenarios", "quiz", "content_version"):
        if field not in word:
            errors.append(f"missing field: {field}")

    if "word_id" in word and not re.match(r"^[a-z0-9-]+$", word.get("word_id", "")):
        errors.append(f"word_id must be kebab-case: {word.get('word_id')}")

    if "level" in word and word["level"] not in VALID_LEVELS:
        errors.append(f"invalid level: {word.get('level')}")

    if "track" in word and word["track"] not in VALID_TRACKS:
        errors.append(f"invalid track: {word.get('track')}")

    if "ipa" in word and not (word["ipa"].startswith("/") and word["ipa"].endswith("/")):
        errors.append(f"ipa must start and end with /")

    scenarios = word.get("scenarios", [])
    if len(scenarios) != 3:
        errors.append(f"scenarios must have exactly 3 items, got {len(scenarios)}")
    for sc in scenarios:
        if sc.get("context") not in VALID_CONTEXTS:
            errors.append(f"invalid context: {sc.get('context')}")

    quiz = word.get("quiz", {})
    if "blank_sentence" in quiz and "_____" not in quiz["blank_sentence"]:
        errors.append("quiz.blank_sentence must contain _____")
    opts = quiz.get("options", [])
    if len(opts) != 4:
        errors.append(f"quiz.options must have 4 items, got {len(opts)}")
    if "answer" in quiz and quiz["answer"] not in opts:
        errors.append("quiz.answer must be in quiz.options")

    pv = word.get("phrasal_verbs", [])
    if not isinstance(pv, list) or len(pv) < 1:
        errors.append("phrasal_verbs must be non-empty array")

    return errors


def build_prompt(count: int, existing_words: set, batch_index: int) -> str:
    level_hints = {
        "B1": "중급, 비즈니스/사회 빈출 (figure out, follow up, reach out 등)",
        "B2": "중상급, 의미 미묘한 phrasal verb (come up with, put up with, get along with)",
        "C1": "고급, 원어민 관용 표현 (bear with, make do with, come to terms with, live up to 등)",
    }
    # Shift toward B1/B2/C1 to avoid duplicating common A2 words
    levels = ["B1", "B2", "B1", "C1", "B2", "B1", "C1", "B2"]
    level = levels[batch_index % len(levels)]

    # Pass all existing words to maximally avoid duplicates
    excluded = ", ".join(sorted(existing_words)) if existing_words else "없음"

    return f"""[역할] EveryFive 영어 학습 앱 콘텐츠 생성기. JSON 배열을 정확히 {count}개 생성한다.

[조건]
- level: "{level}" ({level_hints.get(level, '')})
- track: "daily" (직장·생활·일상 어휘)
- 모든 단어는 phrasal verb 우선. 한국인이 입에서 잘 안 나오는 표현.
- 절대 중복 생성 금지. 다음 단어들은 이미 존재하므로 반드시 제외: {excluded}

[스키마] 각 단어 객체:
{{
  "word_id": "kebab-case-{batch_index:03d}-NNN",
  "word": "phrasal verb",
  "level": "{level}",
  "track": "daily",
  "meaning_ko": "한국어 뜻",
  "ipa": "/IPA/",
  "phrasal_verbs": [{{"phrase": "variant", "meaning_ko": "뜻"}}],
  "scenarios": [
    {{"context": "meeting", "example_en": "...", "example_ko": "..."}},
    {{"context": "email", "example_en": "...", "example_ko": "..."}},
    {{"context": "lunch", "example_en": "...", "example_ko": "..."}}
  ],
  "quiz": {{
    "blank_sentence": "Sentence with _____ blank.",
    "answer": "phrasal verb",
    "options": ["phrasal verb", "opt2", "opt3", "opt4"]
  }},
  "content_version": "v1",
  "pronunciation_ko": "한글 발음"
}}

[제약]
- context: meeting, lunch, email, interview, presentation 중 3개 선택
- ipa: 슬래시 포함
- options: 정확히 4개, answer 포함
- word_id: lowercase kebab-case (예: "set-up-266")
- _____ (밑줄 5개)가 blank_sentence에 반드시 포함

[출력] 정확히 {count}개를 JSON 배열로 출력. ```json ... ``` 감싸기. 마지막 줄 ===CODEX_DONE===
"""


def send_via_codex(prompt_text: str, batch_idx: int, timeout: int = 480) -> Optional[list]:
    sys.path.insert(0, str(AI_WORKPLACE_DIR))
    try:
        from scripts.codex_bridge import send_prompt  # type: ignore
    except ImportError:
        print("  [WARN] codex_bridge not available — skipping Codex generation", file=sys.stderr)
        return None

    CODEX_DIR.mkdir(parents=True, exist_ok=True)
    prompt_file = CODEX_DIR / f"prompt_seed_b{batch_idx:02d}.txt"
    result_file = CODEX_DIR / f"result_seed_b{batch_idx:02d}.json"

    prompt_file.write_text(prompt_text, encoding="utf-8")

    instruction = (
        f"'{prompt_file}' 파일을 읽고 지시대로 phrasal verb JSON 배열을 "
        f"응답 텍스트에 직접 출력해. 파일 쓰기 금지."
    )
    result = send_prompt(instruction, save_to=str(result_file), timeout=timeout)

    if not result:
        print(f"  [WARN] Codex returned empty for batch {batch_idx}", file=sys.stderr)
        return None

    # strip markdown fences and CODEX_DONE marker
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
        print(f"  [WARN] Batch {batch_idx}: result is not a list", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"  [WARN] Batch {batch_idx} JSON parse failed: {e}", file=sys.stderr)
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="EveryFive content seed script")
    parser.add_argument("--dry-run", action="store_true", help="Preview plan without modifying files")
    parser.add_argument("--target", type=int, default=500, help="Target total word count")
    parser.add_argument("--batch-size", type=int, default=30, help="Words per Codex batch (max 30)")
    args = parser.parse_args()

    batch_size = min(args.batch_size, 30)

    # Load environment (for future Supabase integration)
    env = load_env_local()
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""))
    if supabase_url:
        print(f"Supabase URL: {supabase_url[:40]}...")

    # Load existing words
    words = load_words()
    existing_count = len(words)
    existing_word_set = {w.get("word", "").lower() for w in words}
    existing_ids = {w.get("word_id", "") for w in words}

    needed = max(0, args.target - existing_count)
    batches = (needed + batch_size - 1) // batch_size if needed > 0 else 0

    print(f"\nCurrent words: {existing_count}")
    print(f"Target:        {args.target}")
    print(f"Need to add:   {needed}")
    print(f"Batches:       {batches} x {batch_size}")
    print(f"words.json:    {CONTENT_WORDS_PATH}")

    if needed == 0:
        print("\nTarget already reached. Nothing to do.")
        return

    if args.dry_run:
        print("\n[DRY RUN] No files will be modified.")
        print(f"Plan: generate {batches} batches of ~{batch_size} words via Codex bridge")
        print(f"Expected final count: {existing_count + needed}")
        return

    # Generate batches
    new_words: list = []
    failed_batches: list[int] = []

    for batch_idx in range(batches):
        remaining = needed - len(new_words)
        if remaining <= 0:
            break
        size = min(batch_size, remaining)
        print(f"\nBatch {batch_idx + 1}/{batches}: generating {size} words...")

        prompt_text = build_prompt(size, existing_word_set, batch_idx)
        batch_result = send_via_codex(prompt_text, batch_idx)

        if batch_result is None:
            failed_batches.append(batch_idx)
            print(f"  [SKIP] Batch {batch_idx + 1} failed — continuing")
            continue

        added = 0
        for word in batch_result:
            word_lower = word.get("word", "").lower()
            word_id = word.get("word_id", "")

            # Dedup by word text
            if word_lower in existing_word_set:
                print(f"  [SKIP] duplicate word: {word.get('word')}")
                continue
            if word_id in existing_ids:
                print(f"  [SKIP] duplicate word_id: {word_id}")
                continue

            errs = validate_word(word)
            if errs:
                print(f"  [SKIP] validation failed for '{word.get('word')}': {errs[:2]}")
                continue

            new_words.append(word)
            existing_word_set.add(word_lower)
            existing_ids.add(word_id)
            added += 1

        print(f"  Added {added} valid words (running total: {len(new_words)})")

    if not new_words:
        print("\nERROR: No new words generated.", file=sys.stderr)
        if failed_batches:
            print(f"Failed batches: {failed_batches}. Ensure Codex bridge is running.", file=sys.stderr)
        sys.exit(1)

    # Merge and save
    merged = words + new_words
    save_words(merged)

    final_count = len(merged)
    print(f"\nDone. words.json updated: {existing_count} → {final_count} (+{len(new_words)})")

    if failed_batches:
        print(f"WARNING: {len(failed_batches)} batch(es) failed: {failed_batches}")

    if final_count < args.target:
        print(f"WARNING: target {args.target} not reached (got {final_count}).")
        print("Re-run the script to generate remaining words.")
        sys.exit(2)

    print(f"SUCCESS: {final_count} >= {args.target}")


if __name__ == "__main__":
    main()
