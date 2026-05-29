-- v1.6: pg_cron으로 send-push-notification Edge Function 매일 UTC 00:00 (KST 09:00) 호출
--
-- 사전 조건:
--   1. app.cron_secret GUC 설정 (Supabase Dashboard > SQL Editor):
--      ALTER DATABASE postgres SET "app.cron_secret" = '<CRON_SECRET값>';
--      SELECT pg_reload_conf();
--   2. Edge Function send-push-notification에 CRON_SECRET secret 설정 (같은 값):
--      supabase secrets set CRON_SECRET=<CRON_SECRET값>
-- 설정 전에는 cron 실행 시 401로 실패 (silent fail 아님).

-- app.cron_secret GUC 사전 검증: 미설정 시 migration 자체를 실패시켜 silent fail 방지
DO $$
DECLARE v_secret TEXT;
BEGIN
  v_secret := current_setting('app.cron_secret', true);
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION
      'app.cron_secret GUC is not set. '
      'Run 022_set_db_settings.sql instructions first: '
      'ALTER DATABASE postgres SET "app.cron_secret" = ''<your-secret>''; '
      'SELECT pg_reload_conf();';
  END IF;
END $$;

-- 기존 스케줄 제거 (없으면 무시)
DO $$ BEGIN
  PERFORM cron.unschedule('send-push-notification');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'send-push-notification',
  '0 0 * * *',
  $$
    SELECT net.http_post(
      url     := 'https://qftncrkvsergtyhilzwa.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', coalesce(current_setting('app.cron_secret', true), '')
      ),
      body    := '{}'::jsonb
    )
  $$
);
