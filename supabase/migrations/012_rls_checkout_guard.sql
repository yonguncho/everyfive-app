-- Migration 012: Close RLS bypass on checkout lock + fix acquire_checkout_lock search_path
--
-- CRITICAL (CrossVal R1): profiles_update RLS policy (002) permits UPDATE on the entire
-- profiles row for id = auth.uid(). This lets a client zero out last_checkout_requested_at
-- via: supabase.from('profiles').update({ last_checkout_requested_at: null })
-- ... and immediately re-trigger checkout, bypassing the 60-second idempotency guard.
-- Fix: revoke column-level UPDATE privilege on that column from authenticated.
-- Only acquire_checkout_lock (SECURITY DEFINER, runs as owner) may write this column.

REVOKE UPDATE(last_checkout_requested_at) ON profiles FROM authenticated;

-- WARNING (CrossVal R1): acquire_checkout_lock (migration 010) was created with
-- SET search_path = public — missing pg_temp, unlike the four functions fixed in 011.
-- Re-create with pg_temp to prevent temp-schema shadowing attacks.

CREATE OR REPLACE FUNCTION acquire_checkout_lock(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  UPDATE profiles
  SET last_checkout_requested_at = NOW()
  WHERE id = p_user_id
    AND (
      last_checkout_requested_at IS NULL
      OR last_checkout_requested_at < NOW() - INTERVAL '60 seconds'
    );

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION acquire_checkout_lock(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION acquire_checkout_lock(uuid) TO authenticated;
