-- Migration 009: A3 checkout race fix
-- Adds last_checkout_requested_at to profiles for atomic idempotency check in create-checkout API.
-- The API does: UPDATE profiles SET last_checkout_requested_at = NOW()
--   WHERE id = $userId AND (last_checkout_requested_at IS NULL OR last_checkout_requested_at < NOW() - INTERVAL '60 seconds')
-- If 0 rows updated → another checkout is in-flight within the last 60s → return 409.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_checkout_requested_at TIMESTAMPTZ;
