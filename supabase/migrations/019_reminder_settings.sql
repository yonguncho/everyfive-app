-- v1.6: 리마인더 설정 컬럼 + 프로필 UPDATE 정책 추가
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS reminder_email_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_subscription JSONB DEFAULT NULL;

-- 기존 UPDATE 정책 있을 경우 충돌 방지
DROP POLICY IF EXISTS profiles_update_own ON profiles;
-- 002_rls_policies에서 생성된 기존 profiles_update 정책도 교체
DROP POLICY IF EXISTS profiles_update ON profiles;

-- profiles.id = auth.uid() (id가 PK이자 auth.users FK)
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- push_subscription은 /api/push-subscribe (service_role)만 쓸 수 있어야 함
-- authenticated가 직접 endpoint를 조작하면 send-push-notification에서 SSRF 발생 가능
REVOKE UPDATE (push_subscription) ON profiles FROM authenticated;
