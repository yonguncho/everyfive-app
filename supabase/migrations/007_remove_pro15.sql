-- pro_15 플랜 제거 (3개 플랜으로 단순화: pro_10 / pro_20 / pro_30)

-- subscriptions.plan CHECK 제약 갱신
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'pro_10', 'pro_20', 'pro_30'));

-- daily queue 생성 함수 갱신 (pro_15 → 제거)
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
