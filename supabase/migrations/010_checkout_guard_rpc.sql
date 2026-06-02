-- Migration 010: Checkout idempotency guard as SECURITY DEFINER RPC
-- Replaces direct client UPDATE on profiles.last_checkout_requested_at, which was
-- vulnerable to bypass: anon-key RLS (profiles_update) lets users reset the column to null
-- and immediately retrigger checkout. SECURITY DEFINER ensures only this function can
-- write last_checkout_requested_at, regardless of client-side RLS.

CREATE OR REPLACE FUNCTION acquire_checkout_lock(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate caller is the same user (prevents impersonation via direct RPC call)
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

-- Revoke direct execute from anon/authenticated (only server should call this via service role or JWT)
REVOKE EXECUTE ON FUNCTION acquire_checkout_lock(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION acquire_checkout_lock(uuid) TO authenticated;
