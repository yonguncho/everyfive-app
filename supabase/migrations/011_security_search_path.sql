-- Migration 011: SECURITY DEFINER 함수에 SET search_path 추가 (schema shadowing 방지)
-- R3 코드 리뷰 반영: 003/007 마이그레이션이 이미 적용된 상태이므로 신규 마이그레이션으로 재정의

-- cleanup_old_events: SET search_path + REVOKE
CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM events WHERE server_received_at < NOW() - INTERVAL '30 days';
END $$;
REVOKE EXECUTE ON FUNCTION cleanup_old_events() FROM anon, authenticated;

-- rollup_daily_stats: SET search_path + REVOKE + NULLIF cast guard
CREATE OR REPLACE FUNCTION rollup_daily_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO daily_stats (
    user_id, date,
    new_words_completed, reviews_completed,
    focused_sessions, quiet_sessions, sessions_with_speech,
    avg_recognition_rate, total_time_seconds
  )
  SELECT
    user_id,
    effective_activity_date_kst AS date,
    COUNT(*) FILTER (WHERE event_type = 'word_learned') AS new_words_completed,
    COUNT(*) FILTER (WHERE event_type = 'review_completed') AS reviews_completed,
    COUNT(DISTINCT (payload->>'session_id')) FILTER (WHERE payload->>'mode' = 'focused') AS focused_sessions,
    COUNT(DISTINCT (payload->>'session_id')) FILTER (WHERE payload->>'mode' = 'quiet') AS quiet_sessions,
    COUNT(*) FILTER (WHERE event_type = 'pronunciation_attempt') AS sessions_with_speech,
    -- NULLIF guards prevent cast errors when payload field is absent or empty string
    AVG(NULLIF(payload->>'recognition_rate', '')::REAL) FILTER (WHERE event_type = 'pronunciation_attempt') AS avg_recognition_rate,
    SUM(NULLIF(payload->>'duration_seconds', '')::INT) AS total_time_seconds
  FROM events
  WHERE effective_activity_date_kst >= CURRENT_DATE - INTERVAL '1 day'
  GROUP BY user_id, effective_activity_date_kst
  ON CONFLICT (user_id, date) DO UPDATE SET
    new_words_completed = EXCLUDED.new_words_completed,
    reviews_completed = EXCLUDED.reviews_completed,
    focused_sessions = EXCLUDED.focused_sessions,
    quiet_sessions = EXCLUDED.quiet_sessions,
    sessions_with_speech = EXCLUDED.sessions_with_speech,
    avg_recognition_rate = EXCLUDED.avg_recognition_rate,
    total_time_seconds = EXCLUDED.total_time_seconds;
END $$;
REVOKE EXECUTE ON FUNCTION rollup_daily_stats() FROM anon, authenticated;

-- generate_daily_queue_for_all_users: SET search_path + REVOKE
CREATE OR REPLACE FUNCTION generate_daily_queue_for_all_users()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE u RECORD;
BEGIN
  FOR u IN
    SELECT p.id, COALESCE(s.plan, 'free') AS plan
    FROM profiles p
    LEFT JOIN subscriptions s ON s.user_id = p.id
    WHERE p.last_active_at > NOW() - INTERVAL '30 days'
  LOOP
    PERFORM generate_daily_queue_for_user(u.id, u.plan);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION generate_daily_queue_for_all_users() FROM anon, authenticated;

-- generate_daily_queue_for_user: SET search_path + REVOKE (pro_15 제거 포함)
CREATE OR REPLACE FUNCTION generate_daily_queue_for_user(uid UUID, user_plan TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  today DATE := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
  new_count INT := CASE user_plan
    WHEN 'pro_10' THEN 10
    WHEN 'pro_20' THEN 20
    WHEN 'pro_30' THEN 30
    ELSE 5
  END;
  review_cap INT := CASE WHEN user_plan = 'free' THEN 15 ELSE 30 END;
BEGIN
  INSERT INTO daily_queue (user_id, date, new_count, review_count)
  VALUES (uid, today, new_count, 0)
  ON CONFLICT (user_id, date) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION generate_daily_queue_for_user(UUID, TEXT) FROM anon, authenticated;
