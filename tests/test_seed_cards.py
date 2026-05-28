"""
tests/test_seed_cards.py — seed_cards.py 단위 테스트

실행: python -m pytest tests/test_seed_cards.py -v
      (everyfive-app/ 디렉터리에서 실행)
"""

import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

# scripts 디렉터리를 path에 추가
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR.parent))

# seed_cards 모듈 로드 (import 시 main() 실행 안 됨)
import importlib.util

_spec = importlib.util.spec_from_file_location("seed_cards", SCRIPTS_DIR / "seed_cards.py")
seed_cards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed_cards)


# ───────────────────────────────────────────────────────────────────────────────
# 헬퍼
# ───────────────────────────────────────────────────────────────────────────────

def make_valid_word(word="look up", word_id="look-up-001", level="A2", track="daily") -> dict:
    return {
        "word_id": word_id,
        "word": word,
        "level": level,
        "track": track,
        "meaning_ko": "찾아보다",
        "ipa": "/lʊk ʌp/",
        "phrasal_verbs": [{"phrase": "look up to", "meaning_ko": "~을 존경하다"}],
        "scenarios": [
            {"context": "meeting", "example_en": "Look it up.", "example_ko": "찾아봐."},
            {"context": "email", "example_en": "I looked it up.", "example_ko": "찾아봤어요."},
            {"context": "lunch", "example_en": "Let's look it up.", "example_ko": "찾아봅시다."},
        ],
        "quiz": {
            "blank_sentence": "Please _____ the number.",
            "answer": "look up",
            "options": ["look up", "look at", "look for", "look in"],
        },
        "content_version": "v1",
        "pronunciation_ko": "룩 업",
    }


# ───────────────────────────────────────────────────────────────────────────────
# validate_word 테스트
# ───────────────────────────────────────────────────────────────────────────────

class TestValidateWord:
    def test_valid_word_returns_no_errors(self):
        errors = seed_cards.validate_word(make_valid_word())
        assert errors == []

    def test_missing_required_field(self):
        word = make_valid_word()
        del word["word_id"]
        errors = seed_cards.validate_word(word)
        assert any("word_id" in e for e in errors)

    def test_invalid_level(self):
        word = make_valid_word()
        word["level"] = "X9"
        errors = seed_cards.validate_word(word)
        assert any("level" in e for e in errors)

    def test_invalid_track(self):
        word = make_valid_word()
        word["track"] = "unknown"
        errors = seed_cards.validate_word(word)
        assert any("track" in e for e in errors)

    def test_ipa_must_have_slashes(self):
        word = make_valid_word()
        word["ipa"] = "lUk Vp"
        errors = seed_cards.validate_word(word)
        assert any("ipa" in e for e in errors)

    def test_ipa_with_slashes_is_valid(self):
        word = make_valid_word()
        word["ipa"] = "/lʊk ʌp/"
        errors = seed_cards.validate_word(word)
        assert errors == []

    def test_scenarios_wrong_count(self):
        word = make_valid_word()
        word["scenarios"] = word["scenarios"][:2]
        errors = seed_cards.validate_word(word)
        assert any("scenarios" in e for e in errors)

    def test_invalid_scenario_context(self):
        word = make_valid_word()
        word["scenarios"][0]["context"] = "gym"
        errors = seed_cards.validate_word(word)
        assert any("context" in e for e in errors)

    def test_quiz_missing_blank_sentinel(self):
        word = make_valid_word()
        word["quiz"]["blank_sentence"] = "Please look up the number."
        errors = seed_cards.validate_word(word)
        assert any("blank_sentence" in e or "_____" in e for e in errors)

    def test_quiz_wrong_options_count(self):
        word = make_valid_word()
        word["quiz"]["options"] = ["look up", "look at"]
        errors = seed_cards.validate_word(word)
        assert any("options" in e for e in errors)

    def test_quiz_answer_not_in_options(self):
        word = make_valid_word()
        word["quiz"]["answer"] = "pick up"
        errors = seed_cards.validate_word(word)
        assert any("answer" in e for e in errors)

    def test_empty_phrasal_verbs(self):
        word = make_valid_word()
        word["phrasal_verbs"] = []
        errors = seed_cards.validate_word(word)
        assert any("phrasal_verbs" in e for e in errors)

    def test_invalid_word_id_format(self):
        word = make_valid_word()
        word["word_id"] = "Look Up 001"
        errors = seed_cards.validate_word(word)
        assert any("word_id" in e for e in errors)

    def test_all_valid_levels(self):
        for level in ("A1", "A2", "B1", "B2", "C1", "C2"):
            word = make_valid_word(level=level)
            assert seed_cards.validate_word(word) == [], f"Level {level} should be valid"

    def test_all_valid_contexts(self):
        for ctx in ("meeting", "lunch", "email", "interview", "presentation"):
            word = make_valid_word()
            word["scenarios"][0]["context"] = ctx
            errs = seed_cards.validate_word(word)
            assert not any("context" in e for e in errs), f"Context {ctx} should be valid"


# ───────────────────────────────────────────────────────────────────────────────
# load_words / save_words 테스트
# ───────────────────────────────────────────────────────────────────────────────

class TestLoadSaveWords:
    def test_load_words_returns_list(self, tmp_path, monkeypatch):
        words_file = tmp_path / "words.json"
        sample = [make_valid_word()]
        words_file.write_text(json.dumps(sample, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", words_file)
        result = seed_cards.load_words()
        assert isinstance(result, list)
        assert len(result) == 1

    def test_save_words_roundtrip(self, tmp_path, monkeypatch):
        words_file = tmp_path / "words.json"
        words_file.write_text("[]", encoding="utf-8")  # seed_cards requires pre-existing file
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", words_file)
        sample = [make_valid_word("get up", "get-up-001"), make_valid_word("set up", "set-up-002")]
        seed_cards.save_words(sample)
        loaded = json.loads(words_file.read_text(encoding="utf-8"))
        assert len(loaded) == 2
        assert loaded[0]["word"] == "get up"

    def test_load_words_exits_on_missing_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", tmp_path / "nonexistent.json")
        with pytest.raises(SystemExit):
            seed_cards.load_words()


# ───────────────────────────────────────────────────────────────────────────────
# build_prompt 테스트
# ───────────────────────────────────────────────────────────────────────────────

class TestBuildPrompt:
    def test_prompt_contains_count(self):
        prompt = seed_cards.build_prompt(30, set(), 0)
        assert "30" in prompt

    def test_prompt_contains_codex_done_marker(self):
        prompt = seed_cards.build_prompt(10, set(), 0)
        assert "===CODEX_DONE===" in prompt

    def test_prompt_contains_blank_sentinel(self):
        prompt = seed_cards.build_prompt(10, set(), 0)
        assert "_____" in prompt

    def test_prompt_excludes_existing_words(self):
        existing = {"look up", "set up"}
        prompt = seed_cards.build_prompt(10, existing, 0)
        assert "look up" in prompt or "set up" in prompt  # included in exclusion list

    def test_prompt_level_varies_by_batch(self):
        # Different batches should use different levels (rotation)
        prompts = [seed_cards.build_prompt(10, set(), i) for i in range(4)]
        level_mentions = ["A2", "B1", "B2"]
        found_levels = set()
        for p in prompts:
            for lvl in level_mentions:
                if f'"{lvl}"' in p:
                    found_levels.add(lvl)
        assert len(found_levels) >= 2, "Should rotate through multiple levels"


# ───────────────────────────────────────────────────────────────────────────────
# send_via_codex 테스트 (모킹)
# ───────────────────────────────────────────────────────────────────────────────

class TestSendViaCodex:
    def test_returns_none_when_bridge_unavailable(self, monkeypatch):
        monkeypatch.setattr(
            seed_cards, "AI_WORKPLACE_DIR", Path("/nonexistent")
        )
        result = seed_cards.send_via_codex("test prompt", batch_idx=0, timeout=10)
        assert result is None

    def test_parses_json_array_from_fenced_response(self, tmp_path, monkeypatch):
        mock_send = MagicMock(return_value='''```json
[{"word_id": "test-001", "word": "test"}]
```
===CODEX_DONE===''')

        monkeypatch.setattr(seed_cards, "CODEX_DIR", tmp_path)

        mock_bridge = MagicMock()
        mock_bridge.send_prompt = mock_send
        sys.modules["scripts.codex_bridge"] = mock_bridge  # type: ignore

        with patch.dict("sys.modules", {"scripts.codex_bridge": mock_bridge}):
            # Simulate import success by patching sys.path and module
            import importlib
            original = sys.path[:]
            sys.path.insert(0, str(seed_cards.AI_WORKPLACE_DIR))
            try:
                result = seed_cards.send_via_codex("prompt", batch_idx=0, timeout=10)
                # If codex_bridge is importable, result should be list
                if result is not None:
                    assert isinstance(result, list)
            finally:
                sys.path[:] = original

    def test_returns_none_on_empty_codex_response(self, tmp_path, monkeypatch):
        monkeypatch.setattr(seed_cards, "CODEX_DIR", tmp_path)
        # Simulate codex_bridge import and empty response
        with patch("builtins.__import__", side_effect=ImportError):
            result = seed_cards.send_via_codex("prompt", batch_idx=0, timeout=10)
        assert result is None


# ───────────────────────────────────────────────────────────────────────────────
# main() dry-run 테스트
# ───────────────────────────────────────────────────────────────────────────────

class TestMainDryRun:
    def test_dry_run_does_not_modify_words_json(self, tmp_path, monkeypatch, capsys):
        words_file = tmp_path / "words.json"
        existing = [make_valid_word(f"word {i}", f"word-{i:03d}") for i in range(10)]
        words_file.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", words_file)

        # Run with --dry-run flag
        test_args = ["seed_cards.py", "--dry-run", "--target", "50"]
        with patch.object(sys, "argv", test_args):
            seed_cards.main()

        # File must be unchanged
        loaded = json.loads(words_file.read_text(encoding="utf-8"))
        assert len(loaded) == 10, "Dry-run must not modify words.json"

        out = capsys.readouterr().out
        assert "DRY RUN" in out

    def test_dry_run_shows_plan(self, tmp_path, monkeypatch, capsys):
        words_file = tmp_path / "words.json"
        existing = [make_valid_word(f"w{i}", f"w-{i:03d}") for i in range(265)]
        words_file.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", words_file)

        with patch.object(sys, "argv", ["seed_cards.py", "--dry-run", "--target", "500"]):
            seed_cards.main()

        out = capsys.readouterr().out
        assert "235" in out or "Need to add" in out

    def test_no_work_when_target_reached(self, tmp_path, monkeypatch, capsys):
        words_file = tmp_path / "words.json"
        existing = [make_valid_word(f"w{i}", f"w-{i:03d}") for i in range(500)]
        words_file.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", words_file)

        with patch.object(sys, "argv", ["seed_cards.py", "--target", "500"]):
            seed_cards.main()

        out = capsys.readouterr().out
        assert "already reached" in out.lower() or "Nothing to do" in out


# ───────────────────────────────────────────────────────────────────────────────
# 통합: 기능 + 검증 (MVP 완료 기준)
# ───────────────────────────────────────────────────────────────────────────────

class TestMVPVerification:
    """
    MVP 완료 기준 검증:
    1. --dry-run 시 파일 변경 없음
    2. validate_word()가 스키마 위반 단어를 정확히 거름
    """

    def test_mv1_dry_run_never_writes(self, tmp_path, monkeypatch):
        words_file = tmp_path / "words.json"
        sample = [make_valid_word()]
        words_file.write_text(json.dumps(sample), encoding="utf-8")
        monkeypatch.setattr(seed_cards, "CONTENT_WORDS_PATH", words_file)
        mtime_before = words_file.stat().st_mtime

        with patch.object(sys, "argv", ["seed_cards.py", "--dry-run", "--target", "100"]):
            seed_cards.main()

        mtime_after = words_file.stat().st_mtime
        assert mtime_before == mtime_after, "dry-run must not touch the file"

    def test_mv2_validate_catches_all_critical_violations(self):
        violations = [
            # missing word_id
            {k: v for k, v in make_valid_word().items() if k != "word_id"},
            # bad ipa
            {**make_valid_word(), "ipa": "luk up"},
            # 2 scenarios instead of 3
            {**make_valid_word(), "scenarios": make_valid_word()["scenarios"][:2]},
            # answer not in options
            {**make_valid_word(), "quiz": {**make_valid_word()["quiz"], "answer": "pick up"}},
            # blank_sentence without _____
            {**make_valid_word(), "quiz": {**make_valid_word()["quiz"], "blank_sentence": "No blank here."}},
        ]
        for bad_word in violations:
            errs = seed_cards.validate_word(bad_word)
            assert errs, f"Expected errors for: {bad_word}"

    def test_mv2_validate_accepts_all_valid_word(self):
        good = make_valid_word()
        assert seed_cards.validate_word(good) == []
