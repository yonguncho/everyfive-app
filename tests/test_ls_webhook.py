"""ls-webhook 로직 단위 테스트 — HMAC 검증, UUID, mapStatus, variant 플랜"""
import hashlib
import hmac
import re

import pytest


# ---------------------------------------------------------------------------
# 헬퍼: ls-webhook과 동일한 로직을 Python으로 포팅
# ---------------------------------------------------------------------------

def verify_signature(body: bytes, secret: str, signature: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def is_valid_uuid(s: str) -> bool:
    return bool(UUID_RE.match(s))


STATUS_MAP: dict[str, str] = {
    "on_trial": "TRIAL",
    "active": "ACTIVE",
    "paused": "PAST_DUE",
    "past_due": "PAST_DUE",
    "unpaid": "PAST_DUE",
    "cancelled": "CANCELED",
    "expired": "CANCELED",
}


def map_status(ls_status: str) -> str | None:
    return STATUS_MAP.get(ls_status)


VARIANT_PLAN: dict[int, str] = {
    1704407: "pro_10",
    1704429: "pro_20",
    1704432: "pro_30",
}

HANDLED_EVENTS = {
    "subscription_created",
    "subscription_updated",
    "subscription_cancelled",
    "subscription_expired",
    "subscription_paused",
    "subscription_unpaused",
}


# ---------------------------------------------------------------------------
# HMAC 서명 검증
# ---------------------------------------------------------------------------

class TestHmacVerification:
    def _sign(self, body: bytes, secret: str) -> str:
        return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    def test_valid_signature_passes(self):
        body = b'{"event":"subscription_created"}'
        secret = "test-secret"
        assert verify_signature(body, secret, self._sign(body, secret)) is True

    def test_wrong_signature_fails(self):
        body = b'{"event":"subscription_created"}'
        assert verify_signature(body, "test-secret", "deadbeefdeadbeef") is False

    def test_tampered_body_fails(self):
        body = b'{"event":"subscription_created"}'
        sig = self._sign(body, "test-secret")
        assert verify_signature(b'{"event":"tampered"}', "test-secret", sig) is False

    def test_wrong_secret_fails(self):
        body = b'{"event":"subscription_created"}'
        sig = self._sign(body, "correct-secret")
        assert verify_signature(body, "wrong-secret", sig) is False

    def test_empty_body_still_verifiable(self):
        body = b""
        secret = "s"
        assert verify_signature(body, secret, self._sign(body, secret)) is True


# ---------------------------------------------------------------------------
# UUID 유효성 검사
# ---------------------------------------------------------------------------

class TestUuidValidation:
    def test_valid_lowercase_uuid(self):
        assert is_valid_uuid("550e8400-e29b-41d4-a716-446655440000") is True

    def test_valid_uppercase_uuid(self):
        assert is_valid_uuid("550E8400-E29B-41D4-A716-446655440000") is True

    def test_invalid_uuid_no_dashes(self):
        assert is_valid_uuid("550e8400e29b41d4a716446655440000") is False

    def test_invalid_uuid_too_short(self):
        assert is_valid_uuid("550e8400-e29b-41d4") is False

    def test_invalid_uuid_empty_string(self):
        assert is_valid_uuid("") is False

    def test_invalid_uuid_with_spaces(self):
        assert is_valid_uuid("550e8400-e29b-41d4-a716-44665544000 ") is False


# ---------------------------------------------------------------------------
# mapStatus
# ---------------------------------------------------------------------------

class TestMapStatus:
    def test_active_maps_to_active(self):
        assert map_status("active") == "ACTIVE"

    def test_on_trial_maps_to_trial(self):
        assert map_status("on_trial") == "TRIAL"

    def test_paused_maps_to_past_due(self):
        assert map_status("paused") == "PAST_DUE"

    def test_past_due_maps_to_past_due(self):
        assert map_status("past_due") == "PAST_DUE"

    def test_unpaid_maps_to_past_due(self):
        assert map_status("unpaid") == "PAST_DUE"

    def test_cancelled_maps_to_canceled(self):
        assert map_status("cancelled") == "CANCELED"

    def test_expired_maps_to_canceled(self):
        assert map_status("expired") == "CANCELED"

    def test_unknown_status_returns_none(self):
        assert map_status("free") is None

    def test_empty_string_returns_none(self):
        assert map_status("") is None


# ---------------------------------------------------------------------------
# Variant → plan 매핑
# ---------------------------------------------------------------------------

class TestVariantPlan:
    def test_variant_1704407_is_pro_10(self):
        assert VARIANT_PLAN.get(1704407) == "pro_10"

    def test_variant_1704429_is_pro_20(self):
        assert VARIANT_PLAN.get(1704429) == "pro_20"

    def test_variant_1704432_is_pro_30(self):
        assert VARIANT_PLAN.get(1704432) == "pro_30"

    def test_unknown_variant_returns_none(self):
        assert VARIANT_PLAN.get(9999999) is None

    def test_three_plans_exist(self):
        assert len(VARIANT_PLAN) == 3


# ---------------------------------------------------------------------------
# 처리 이벤트 목록
# ---------------------------------------------------------------------------

class TestHandledEvents:
    @pytest.mark.parametrize("event", [
        "subscription_created",
        "subscription_updated",
        "subscription_cancelled",
        "subscription_expired",
        "subscription_paused",
        "subscription_unpaused",
    ])
    def test_known_events_are_handled(self, event):
        assert event in HANDLED_EVENTS

    def test_unknown_event_not_handled(self):
        assert "subscription_unknown" not in HANDLED_EVENTS

    def test_six_events_defined(self):
        assert len(HANDLED_EVENTS) == 6
