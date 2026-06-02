"""Migration 012 — RLS 보안 픽스 검증 테스트"""
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "supabase" / "migrations" / "012_rls_checkout_guard.sql"
)


@pytest.fixture(scope="module")
def sql() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 파일 존재
# ---------------------------------------------------------------------------

class TestFileExists:
    def test_migration_file_present(self):
        assert MIGRATION_PATH.exists(), f"Migration 012 없음: {MIGRATION_PATH}"


# ---------------------------------------------------------------------------
# CRITICAL: last_checkout_requested_at 컬럼 직접 UPDATE 차단
# ---------------------------------------------------------------------------

class TestColumnRevoke:
    def test_revoke_column_update_present(self, sql):
        assert "REVOKE UPDATE(last_checkout_requested_at)" in sql

    def test_revoke_targets_profiles_table(self, sql):
        assert "ON profiles" in sql

    def test_revoke_from_authenticated(self, sql):
        assert "FROM authenticated" in sql


# ---------------------------------------------------------------------------
# WARNING: acquire_checkout_lock search_path 수정
# ---------------------------------------------------------------------------

class TestAcquireCheckoutLockFunction:
    def test_function_recreated(self, sql):
        assert "CREATE OR REPLACE FUNCTION acquire_checkout_lock" in sql

    def test_search_path_includes_pg_temp(self, sql):
        assert "public, pg_temp" in sql

    def test_security_definer_present(self, sql):
        assert "SECURITY DEFINER" in sql

    def test_function_checks_auth_uid(self, sql):
        assert "auth.uid()" in sql

    def test_60_second_idempotency_guard_present(self, sql):
        assert "60 seconds" in sql

    def test_function_updates_last_checkout_column(self, sql):
        assert "last_checkout_requested_at" in sql


# ---------------------------------------------------------------------------
# 권한 재설정
# ---------------------------------------------------------------------------

class TestPermissions:
    def test_anon_execute_revoked(self, sql):
        assert "REVOKE EXECUTE ON FUNCTION acquire_checkout_lock" in sql
        assert "FROM anon" in sql

    def test_authenticated_execute_granted(self, sql):
        assert "GRANT EXECUTE ON FUNCTION acquire_checkout_lock" in sql
        assert "TO authenticated" in sql
