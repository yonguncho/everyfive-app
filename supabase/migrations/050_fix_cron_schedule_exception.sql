-- migration 050: 014_daily_queue.sql의 cron.schedule silent fail 수정
-- WHY: 014에서 DO $$ EXCEPTION WHEN OTHERS THEN NULL 패턴이 cron.schedule 실패를
--      조용히 삼켜 pg_cron 미활성 여부를 알 수 없었음.
-- 규칙: EXCEPTION WHEN OTHERS THEN NULL은 cron.unschedule(idempotent) 전용.
--       cron.schedule 예외는 RAISE WARNING으로 로그 가시성 확보.

-- 1. 기존 스케줄 제거 (존재하지 않아도 무시 — unschedule은 idempotent)
DO $$ BEGIN
  PERFORM cron.unschedule('daily-queue-ttl');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. 재등록 — 실패 시 RAISE WARNING으로 로그 출력 (silent fail 방지)
DO $$
BEGIN
  PERFORM cron.schedule(
    'daily-queue-ttl',
    '0 3 * * *',
    $cron$ DELETE FROM public.daily_queue WHERE generated_at < now() - interval '30 days'; $cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron 미활성: daily-queue-ttl 등록 실패 — %', SQLERRM;
END $$;
