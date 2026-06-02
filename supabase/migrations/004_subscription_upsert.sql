-- Atomic subscription upsert with ordering guard
-- Stripe webhook이 호출. ACTIVE → TRIAL downgrade 차단, stale event 차단.

CREATE OR REPLACE FUNCTION upsert_subscription_with_guard(
  p_user_id UUID,
  p_stripe_customer_id TEXT,
  p_stripe_subscription_id TEXT,
  p_plan TEXT,
  p_status TEXT,
  p_current_period_end TIMESTAMPTZ,
  p_trial_end TIMESTAMPTZ,
  p_cancel_at_period_end BOOLEAN,
  p_stripe_event_ts TIMESTAMPTZ  -- event.created 또는 동등한 monotonic 값
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_row RECORD;
  final_status TEXT;
BEGIN
  -- Lock the row (SELECT FOR UPDATE) — 동시 webhook 직렬화
  SELECT * INTO current_row FROM subscriptions WHERE user_id = p_user_id FOR UPDATE;

  -- Stale check: 이미 더 늦은 event 처리된 경우 skip
  IF current_row.stripe_subscription_updated_at IS NOT NULL
     AND p_stripe_event_ts < current_row.stripe_subscription_updated_at THEN
    RETURN 'STALE_SKIPPED';
  END IF;

  -- Status precedence: ACTIVE → TRIAL downgrade 차단
  IF current_row.status = 'ACTIVE' AND p_status = 'TRIAL' THEN
    RETURN 'DOWNGRADE_BLOCKED';
  END IF;

  -- Final status: cancel_at_period_end 우선 적용
  final_status := CASE
    WHEN p_cancel_at_period_end THEN 'CANCELED_AT_PERIOD_END'
    ELSE p_status
  END;

  INSERT INTO subscriptions (
    user_id, stripe_customer_id, stripe_subscription_id,
    plan, status, current_period_end, trial_end, cancel_at_period_end,
    stripe_subscription_updated_at, updated_at
  ) VALUES (
    p_user_id, p_stripe_customer_id, p_stripe_subscription_id,
    p_plan, final_status, p_current_period_end, p_trial_end, p_cancel_at_period_end,
    p_stripe_event_ts, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    plan = EXCLUDED.plan,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    trial_end = EXCLUDED.trial_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    stripe_subscription_updated_at = EXCLUDED.stripe_subscription_updated_at,
    updated_at = NOW();

  RETURN 'OK';
END $$;
