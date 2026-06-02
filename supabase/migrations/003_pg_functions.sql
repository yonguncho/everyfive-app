-- EveryFive PL/pgSQL Functions
-- Architecture v4 Section 2.2

-- ============================================
-- Advisory Lock helpers (Edge Function이 호출)
-- service_role 전용: anon/authenticated에서 직접 호출 불가
-- ============================================
CREATE OR REPLACE FUNCTION try_advisory_lock(user_id UUID, word_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  RETURN pg_try_advisory_lock(
    hashtext(user_id::text || word_id::text)::bigint
  );
END $$;
REVOKE EXECUTE ON FUNCTION try_advisory_lock(UUID, UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION release_advisory_lock(user_id UUID, word_id UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_unlock(
    hashtext(user_id::text || word_id::text)::bigint
  );
END $$;
REVOKE EXECUTE ON FUNCTION release_advisory_lock(UUID, UUID) FROM anon, authenticated;

-- ============================================
-- 30일 events TTL (매일 03:00 KST = 18:00 UTC)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM events WHERE server_received_at < NOW() - INTERVAL '30 days';
END $$;
REVOKE EXECUTE ON FUNCTION cleanup_old_events() FROM anon, authenticated;

-- ============================================
-- 매일 23:59 KST rollup (= 14:59 UTC)
-- effective_activity_date_kst 기준 집계
-- ============================================
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

-- ============================================
-- 매일 00:00 KST daily queue 생성 (= 15:00 UTC)
-- ============================================
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

-- 단일 사용자용 daily queue 생성
CREATE OR REPLACE FUNCTION generate_daily_queue_for_user(uid UUID, user_plan TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  today DATE := (NOW() AT TIME ZONE 'Asia/Seoul')::DATE;
  new_count INT := CASE user_plan
    WHEN 'pro_10' THEN 10
    WHEN 'pro_15' THEN 15
    WHEN 'pro_20' THEN 20
    WHEN 'pro_30' THEN 30
    ELSE 5
  END;
  review_cap INT := CASE WHEN user_plan = 'free' THEN 15 ELSE 30 END;
BEGIN
  -- daily_queue 메타
  INSERT INTO daily_queue (user_id, date, new_count, review_count)
  VALUES (uid, today, new_count, 0)
  ON CONFLICT (user_id, date) DO NOTHING;

  -- TODO: 실제 word_id 선정 로직은 콘텐츠 가용성에 따라 다음 마이그레이션에서 구현
  -- Phase 1.0 MVP는 클라이언트가 직접 콘텐츠 CDN에서 fetch + 무작위 선정
END $$;
REVOKE EXECUTE ON FUNCTION generate_daily_queue_for_user(UUID, TEXT) FROM anon, authenticated;

-- ============================================
-- pg_cron 스케줄 (Supabase에 pg_cron 확장 필요)
-- ============================================
-- Supabase Studio에서 수동 실행 또는 별도 migration 005에서 처리
-- SELECT cron.schedule('daily-queue',       '0 15 * * *', 'SELECT generate_daily_queue_for_all_users()');
-- SELECT cron.schedule('daily-stats-rollup','59 14 * * *', 'SELECT rollup_daily_stats()');
-- SELECT cron.schedule('cleanup-old-events','0 18 * * *', 'SELECT cleanup_old_events()');
