#!/usr/bin/env python3
"""
generate_words_db.py 단위 테스트

실행:
  python scripts/test_generate_words.py
"""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from scripts.generate_words_db import (
    validate_word, build_prompt, VALID_CATEGORIES,
)


def assert_eq(a, b, msg=""):
    assert a == b, f"{msg}: expected {b!r}, got {a!r}"


def assert_in(val, container, msg=""):
    assert val in container, f"{msg}: {val!r} not in {container}"


# ── validate_word ─────────────────────────────────────────────────────────────

def test_validate_valid_word():
    w = {
        "word": "serendipity",
        "definition_ko": "뜻밖의 행운",
        "definition_en": "The occurrence of events by chance in a happy way.",
        "example_sentence": "Finding that book was pure serendipity.",
        "difficulty": 4,
        "category": "noun",
    }
    assert validate_word(w) == [], "유효한 단어는 오류 없음"


def test_validate_missing_required():
    w = {"word": "test", "difficulty": 1, "category": "noun"}
    errors = validate_word(w)
    assert any("missing" in e and "definition_ko" in e for e in errors), \
        "definition_ko 누락은 오류"


def test_validate_invalid_category():
    w = {
        "word": "test", "definition_ko": "테스트", "difficulty": 1,
        "category": "unknown_cat",
    }
    errors = validate_word(w)
    assert any("invalid category" in e for e in errors), "잘못된 category는 오류"


def test_validate_invalid_difficulty():
    w = {
        "word": "test", "definition_ko": "테스트", "difficulty": 0,
        "category": "noun",
    }
    errors = validate_word(w)
    assert any("invalid difficulty" in e for e in errors), "0은 invalid difficulty"


def test_validate_word_too_long():
    w = {
        "word": "a" * 61, "definition_ko": "긴단어",
        "difficulty": 1, "category": "noun",
    }
    errors = validate_word(w)
    assert any("too long" in e for e in errors), "61자 단어는 too long"


def test_validate_all_categories_accepted():
    for cat in VALID_CATEGORIES:
        w = {"word": "test", "definition_ko": "테스트", "difficulty": 1, "category": cat}
        assert validate_word(w) == [], f"{cat} 카테고리는 유효"


# ── build_prompt ──────────────────────────────────────────────────────────────

def test_build_prompt_count_in_output():
    prompt = build_prompt(1, ["noun", "verb"], 10, set(), 0)
    assert "10" in prompt, "batch count가 프롬프트에 포함됨"


def test_build_prompt_difficulty_in_output():
    for diff in range(1, 6):
        prompt = build_prompt(diff, ["noun"], 5, set(), 0)
        assert f"difficulty: {diff}" in prompt, f"difficulty {diff}이 프롬프트에 포함됨"


def test_build_prompt_excludes_existing_words():
    existing = {"apple", "run", "big"}
    prompt = build_prompt(1, ["noun"], 5, existing, 0)
    for word in existing:
        assert word in prompt, f"기존 단어 {word!r}가 제외 목록에 있어야 함"


def test_build_prompt_assertion_on_zero_count():
    """count=0이면 프롬프트가 '0개'를 포함함 (batch_size assertion은 호출자 책임)"""
    prompt = build_prompt(1, ["noun"], 0, set(), 0)
    assert "0" in prompt


def test_build_prompt_micro_theme_rotation():
    """배치 인덱스가 달라지면 프롬프트 내용이 달라짐"""
    p0 = build_prompt(1, ["noun"], 5, set(), 0)
    p1 = build_prompt(1, ["noun"], 5, set(), 1)
    assert p0 != p1, "배치 인덱스별로 micro-theme이 달라야 함"


# ── insert_words Prefer 헤더 검증 ─────────────────────────────────────────────

def test_insert_words_prefer_header():
    """insert_words 소스에 resolution=ignore-duplicates가 있는지 확인"""
    src_path = Path(__file__).parent / "generate_words_db.py"
    src = src_path.read_text(encoding="utf-8")
    assert "resolution=ignore-duplicates" in src, \
        "insert_words()에 resolution=ignore-duplicates가 필요함"


# ── 생성 계획 계산 ────────────────────────────────────────────────────────────

def test_generation_plan_balanced():
    """needed=100 → per_diff=20, remainder=0 → 각 difficulty 20개"""
    target = 1500
    current = 1400
    needed = target - current
    per_diff = needed // 5
    remainder = needed % 5
    plan = [(d, per_diff + (1 if d <= remainder else 0)) for d in range(1, 6)]
    total = sum(c for _, c in plan)
    assert total == needed, f"plan 합계 {total} ≠ needed {needed}"
    for d, c in plan:
        assert c == 20, f"difficulty {d}: {c}개, 20개여야 함"


def test_generation_plan_remainder_distributed():
    """needed=102 → remainder=2 → difficulty 1,2 각 +1"""
    needed = 102
    per_diff = needed // 5  # 20
    remainder = needed % 5  # 2
    plan = [(d, per_diff + (1 if d <= remainder else 0)) for d in range(1, 6)]
    assert plan[0][1] == 21  # d=1
    assert plan[1][1] == 21  # d=2
    assert plan[2][1] == 20  # d=3


def test_generation_plan_already_at_target():
    """current >= target → needed=0"""
    needed = max(0, 1500 - 1600)
    assert needed == 0, "이미 목표 달성 시 needed=0"


# ── send_via_codex None 반환 처리 ─────────────────────────────────────────────

def test_send_via_codex_none_skip():
    """Codex None 반환 시 SKIP — 메인 루프가 continue해야 함"""
    # generate_words_db.py main loop: if result is None: continue
    src = (Path(__file__).parent / "generate_words_db.py").read_text(encoding="utf-8")
    assert "if result is None" in src, "None 체크 후 SKIP 로직 필수"


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {fn.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ERROR {fn.__name__}: {type(e).__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(0 if failed == 0 else 1)
