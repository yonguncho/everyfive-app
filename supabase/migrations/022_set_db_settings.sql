-- v1.6: pg_cron cron_secret GUC 설정 — 배포 후 수동 실행 필요
--
-- 이 파일은 migration으로 자동 적용되지 않습니다.
-- 배포 완료 후 Supabase Dashboard > SQL Editor 에서 아래 명령을 실행하세요:
--
--   ALTER DATABASE postgres SET "app.cron_secret" = 'YOUR_CRON_SECRET_VALUE';
--   SELECT pg_reload_conf();
--
-- YOUR_CRON_SECRET_VALUE는 Edge Function 환경변수 CRON_SECRET과 동일한 값이어야 합니다.
-- 생성 방법: openssl rand -hex 32
--
-- 설정 확인:
--   SELECT current_setting('app.cron_secret', true);
--
-- 이 설정이 없으면 pg_cron이 매일 UTC 00:00에 Edge Function 호출 시 401을 반환합니다.
-- (silent fail이 아닌 401 응답 — supabase.logs에서 확인 가능)

-- 아래는 migration으로 실행해도 무해한 noop placeholder입니다.
DO $$ BEGIN
  RAISE NOTICE 'Reminder: set app.cron_secret GUC manually via Supabase Dashboard SQL Editor.';
END $$;
