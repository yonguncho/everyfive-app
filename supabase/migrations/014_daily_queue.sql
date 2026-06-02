-- migration 014: daily_queue 스키마 변경 + RLS + TTL cron
-- everyfive-app v1.3
-- WHY: daily_queue는 001_initial_schema.sql에서 (user_id, date) PK로 이미 생성됨.
--      CREATE TABLE IF NOT EXISTS는 기존 테이블이 있으면 아무것도 하지 않으므로
--      ALTER TABLE로 v1.0 → v1.3 스키마 변경 (word_ids, session_seed 추가).

-- 1. v1.0 전용 컬럼 제거 (daily_queue_items 정규화 시대의 카운터 컬럼)
ALTER TABLE daily_queue
  DROP COLUMN IF EXISTS new_count,
  DROP COLUMN IF EXISTS review_count;

-- 2. v1.3 신규 컬럼 추가 (프로덕션 첫 배포 → 기존 rows 없음, NOT NULL 직접 적용)
--    DEFAULT는 migration 전환용이며, 이후 INSERT는 반드시 값을 공급해야 함.
ALTER TABLE daily_queue
  ADD COLUMN IF NOT EXISTS word_ids     JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS session_seed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE daily_queue
  ALTER COLUMN word_ids     DROP DEFAULT,
  ALTER COLUMN session_seed DROP DEFAULT;

-- 3. 인덱스 (user_id, date) — PK와 별도로 쿼리 최적화
CREATE INDEX IF NOT EXISTS daily_queue_user_date_idx ON daily_queue(user_id, date);

-- 3. RLS 활성화
ALTER TABLE daily_queue ENABLE ROW LEVEL SECURITY;

-- 4. SELECT 정책: 본인만
CREATE POLICY daily_queue_select ON daily_queue
  FOR SELECT USING (user_id = auth.uid());

-- 5. INSERT/UPDATE/DELETE: authenticated 직접 접근 차단 (Edge Function service_role 전용)
REVOKE INSERT, UPDATE, DELETE ON daily_queue FROM authenticated;

-- 6. TTL cron: 매일 UTC 03:00, 30일 이전 데이터 삭제
-- pg_cron 미지원 시 DO $$ EXCEPTION WHEN OTHERS THEN NULL 패턴으로 skip
DO $$
BEGIN
  PERFORM cron.schedule(
    'daily-queue-ttl',
    '0 3 * * *',
    $cron$ DELETE FROM public.daily_queue WHERE generated_at < now() - interval '30 days'; $cron$
  );
EXCEPTION WHEN OTHERS THEN
  -- pg_cron 미활성화 시 조용히 skip
  NULL;
END
$$;
