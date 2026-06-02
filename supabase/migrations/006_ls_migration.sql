-- Stripe → Lemon Squeezy 마이그레이션
-- subscriptions 컬럼명 변경 + ls_events 테이블 + RPC 교체

-- ============================================
-- subscriptions: 컬럼 이름 변경
-- ============================================
ALTER TABLE subscriptions RENAME COLUMN stripe_customer_id         TO ls_customer_id;
ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_id     TO ls_subscription_id;
ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_updated_at TO ls_subscription_updated_at;

-- ============================================
-- stripe_events → ls_events
-- ============================================
ALTER TABLE stripe_events RENAME TO ls_events;

-- ============================================
-- upsert_subscription_with_guard: LS 파라미터로 교체
-- ============================================
DROP FUNCTION IF EXISTS upsert_subscription_with_guard(UUID,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BOOLEAN,TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION upsert_subscription_with_guard(
  p_user_id              UUID,
  p_ls_customer_id       TEXT,
  p_ls_subscription_id   TEXT,
  p_plan                 TEXT,
  p_status               TEXT,
  p_current_period_end   TIMESTAMPTZ,
  p_trial_end            TIMESTAMPTZ,
  p_cancel_at_period_end BOOLEAN,
  p_ls_event_ts          TIMESTAMPTZ  -- LS subscription.updated_at (monotonic)
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  current_row RECORD;
  final_status TEXT;
BEGIN
  SELECT * INTO current_row FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;

  -- Stale check
  IF current_row.ls_subscription_updated_at IS NOT NULL
     AND p_ls_event_ts < current_row.ls_subscription_updated_at THEN
    RETURN 'STALE_SKIPPED';
  END IF;

  -- ACTIVE → TRIAL downgrade 차단
  IF current_row.status = 'ACTIVE' AND p_status = 'TRIAL' THEN
    RETURN 'DOWNGRADE_BLOCKED';
  END IF;

  final_status := CASE
    WHEN p_cancel_at_period_end THEN 'CANCELED_AT_PERIOD_END'
    ELSE p_status
  END;

  INSERT INTO subscriptions (
    user_id, ls_customer_id, ls_subscription_id,
    plan, status, current_period_end, trial_end, cancel_at_period_end,
    ls_subscription_updated_at, updated_at
  ) VALUES (
    p_user_id, p_ls_customer_id, p_ls_subscription_id,
    p_plan, final_status, p_current_period_end, p_trial_end, p_cancel_at_period_end,
    p_ls_event_ts, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    ls_customer_id             = EXCLUDED.ls_customer_id,
    ls_subscription_id         = EXCLUDED.ls_subscription_id,
    plan                       = EXCLUDED.plan,
    status                     = EXCLUDED.status,
    current_period_end         = EXCLUDED.current_period_end,
    trial_end                  = EXCLUDED.trial_end,
    cancel_at_period_end       = EXCLUDED.cancel_at_period_end,
    ls_subscription_updated_at = EXCLUDED.ls_subscription_updated_at,
    updated_at                 = NOW();

  RETURN 'OK';
END $$;
