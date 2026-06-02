"""SM-2 알고리즘 단위 테스트 — sm2Algorithm.ts Python 포팅"""
import pytest

MIN_EASE = 1.3
INITIAL_INTERVAL_SECONDS = 3600
INTERVAL_LADDER_SECONDS = [
    3600,
    86400,
    86400 * 3,
    86400 * 7,
    86400 * 14,
    86400 * 30,
    86400 * 60,
]


def next_interval(current_seconds: int, ease: float) -> int:
    idx = next((i for i, s in enumerate(INTERVAL_LADDER_SECONDS) if s > current_seconds), -1)
    if idx == -1:
        return round(current_seconds * ease)
    return INTERVAL_LADDER_SECONDS[idx]


def apply_review(prev_state, quality: int) -> dict:
    if prev_state is None:
        return {
            "intervalSeconds": INITIAL_INTERVAL_SECONDS,
            "easeFactor": 2.5,
            "lapseCount": 1 if quality < 3 else 0,
        }

    interval_seconds = prev_state["intervalSeconds"]
    ease_factor = prev_state["easeFactor"]
    lapse_count = prev_state["lapseCount"]

    if quality < 3:
        return {
            "intervalSeconds": INITIAL_INTERVAL_SECONDS,
            "easeFactor": max(MIN_EASE, ease_factor - 0.2),
            "lapseCount": lapse_count + 1,
        }

    if quality == 3:
        # TypeScript와 동일: interval 한 단계 진행, ease 변화 없음
        interval_seconds = next_interval(interval_seconds, ease_factor)
    else:
        ease_factor = ease_factor + 0.1 * (quality - 4)
        interval_seconds = next_interval(interval_seconds, ease_factor)

    return {
        "intervalSeconds": interval_seconds,
        "easeFactor": ease_factor,
        "lapseCount": lapse_count,
    }


# ---------------------------------------------------------------------------
# 신규 단어 (prevState = None)
# ---------------------------------------------------------------------------

class TestNewWord:
    def test_first_review_quality4_default_state(self):
        r = apply_review(None, 4)
        assert r["intervalSeconds"] == INITIAL_INTERVAL_SECONDS
        assert r["easeFactor"] == 2.5
        assert r["lapseCount"] == 0

    def test_first_review_quality_below_3_counts_lapse(self):
        r = apply_review(None, 2)
        assert r["intervalSeconds"] == INITIAL_INTERVAL_SECONDS
        assert r["lapseCount"] == 1

    def test_first_review_quality3_no_lapse(self):
        r = apply_review(None, 3)
        assert r["lapseCount"] == 0


# ---------------------------------------------------------------------------
# 실패 (quality < 3) — interval 초기화, ease 감소
# ---------------------------------------------------------------------------

class TestFailReview:
    def _state(self, interval=86400 * 7, ease=2.5, lapse=0):
        return {"intervalSeconds": interval, "easeFactor": ease, "lapseCount": lapse}

    def test_quality0_resets_interval(self):
        r = apply_review(self._state(), 0)
        assert r["intervalSeconds"] == INITIAL_INTERVAL_SECONDS

    def test_quality2_resets_interval(self):
        r = apply_review(self._state(), 2)
        assert r["intervalSeconds"] == INITIAL_INTERVAL_SECONDS

    def test_quality2_decreases_ease_by_0_2(self):
        r = apply_review(self._state(ease=2.5), 2)
        assert r["easeFactor"] == pytest.approx(2.3)

    def test_lapse_count_increments(self):
        r = apply_review(self._state(lapse=2), 1)
        assert r["lapseCount"] == 3

    def test_ease_does_not_drop_below_min(self):
        r = apply_review(self._state(ease=1.4), 2)
        assert r["easeFactor"] >= MIN_EASE

    def test_ease_exactly_at_floor(self):
        r = apply_review(self._state(ease=1.3), 2)
        assert r["easeFactor"] == MIN_EASE


# ---------------------------------------------------------------------------
# 유지 (quality == 3) — interval 유지, ease 약간 감소
# ---------------------------------------------------------------------------

class TestMaintainReview:
    def _state(self, interval=86400, ease=2.5, lapse=0):
        return {"intervalSeconds": interval, "easeFactor": ease, "lapseCount": lapse}

    def test_quality3_advances_interval(self):
        r = apply_review(self._state(interval=86400), 3)
        assert r["intervalSeconds"] > 86400

    def test_quality3_ease_unchanged(self):
        r = apply_review(self._state(ease=2.5), 3)
        assert r["easeFactor"] == pytest.approx(2.5)

    def test_quality3_ease_floor_not_applied(self):
        r = apply_review(self._state(ease=1.3), 3)
        assert r["easeFactor"] == pytest.approx(1.3)

    def test_quality3_lapse_count_unchanged(self):
        r = apply_review(self._state(lapse=1), 3)
        assert r["lapseCount"] == 1


# ---------------------------------------------------------------------------
# 간격 증가 (quality >= 4) — 사다리 진행, ease 증가
# ---------------------------------------------------------------------------

class TestAdvanceReview:
    def _state(self, interval=3600, ease=2.5, lapse=0):
        return {"intervalSeconds": interval, "easeFactor": ease, "lapseCount": lapse}

    def test_quality4_advances_to_next_ladder_step(self):
        r = apply_review(self._state(interval=3600), 4)
        assert r["intervalSeconds"] == 86400

    def test_quality5_also_advances_interval(self):
        r = apply_review(self._state(interval=3600), 5)
        assert r["intervalSeconds"] == 86400

    def test_quality5_higher_ease_than_quality4(self):
        state = self._state()
        r4 = apply_review(state, 4)
        r5 = apply_review(state, 5)
        assert r5["easeFactor"] > r4["easeFactor"]

    def test_quality4_ease_unchanged(self):
        r = apply_review(self._state(ease=2.5), 4)
        assert r["easeFactor"] == pytest.approx(2.5)

    def test_quality5_ease_increases_by_0_1(self):
        r = apply_review(self._state(ease=2.5), 5)
        assert r["easeFactor"] == pytest.approx(2.6)

    def test_ladder_progression_full_sequence(self):
        ladder = INTERVAL_LADDER_SECONDS
        state = self._state(interval=ladder[0])
        for expected in ladder[1:]:
            state = apply_review(state, 4)
            assert state["intervalSeconds"] == expected

    def test_beyond_ladder_uses_ease_multiplier(self):
        state = self._state(interval=86400 * 60, ease=2.0)
        r = apply_review(state, 4)
        assert r["intervalSeconds"] == round(86400 * 60 * 2.0)
