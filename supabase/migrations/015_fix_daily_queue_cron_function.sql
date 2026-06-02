-- migration 015: generate_daily_queue_for_user 함수를 014 스키마에 맞게 업데이트
-- WHY: 014_daily_queue.sql에서 new_count/review_count 컬럼이 DROP되고
--      word_ids(JSONB NOT NULL) / session_seed(INTEGER NOT NULL) 컬럼이 추가됨.
--      003_pg_functions.sql의 함수는 여전히 DROP된 컬럼에 INSERT하려 해
--      migration 014 적용 후 cron 실행 시 컬럼 오류가 발생함.
--      DB cron은 빈 word_ids([])로 row를 pre-create하고,
--      실제 word_ids는 daily_queue Edge Function이 첫 요청 시 UPSERT로 채움.

CREATE OR REPLACE FUNCTION generate_daily_queue_for_user(uid UUID, user_plan TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  today DATE := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
BEGIN
  -- 014 스키마: word_ids=[], session_seed=0 으로 placeholder row 생성
  -- Edge Function이 첫 요청 시 ON CONFLICT DO UPDATE로 실제 값을 채움
  INSERT INTO daily_queue (user_id, date, word_ids, session_seed, generated_at)
  VALUES (uid, today, '[]'::jsonb, 0, NOW())
  ON CONFLICT (user_id, date) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION generate_daily_queue_for_user(UUID, TEXT) FROM anon, authenticated;
