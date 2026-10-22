-- Accounts: session revocation, two-factor sign-in, password resets.
-- Plans: free trial, Starter, Growth and Custom, with store limits and a
-- monthly AI allowance across the owner's stores.

ALTER TABLE "users"
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totp_secret_encrypted" TEXT,
  ADD COLUMN "totp_enabled_at" TIMESTAMPTZ(3),
  ADD COLUMN "recovery_codes" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'trial',
  ADD COLUMN "plan_status" TEXT NOT NULL DEFAULT 'trialing',
  ADD COLUMN "trial_ends_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days'),
  ADD COLUMN "plan_renews_at" TIMESTAMPTZ(3),
  ADD COLUMN "plan_store_limit" INTEGER,
  ADD COLUMN "plan_ai_allowance_inr" DECIMAL(10,2),
  ADD COLUMN "razorpay_subscription_id" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_plan_check" CHECK ("plan" IN ('trial', 'starter', 'growth', 'custom'));
ALTER TABLE "users" ADD CONSTRAINT "users_plan_status_check" CHECK ("plan_status" IN ('trialing', 'pending', 'active', 'past_due', 'halted', 'cancelled'));
CREATE UNIQUE INDEX "users_razorpay_subscription_id_key" ON "users"("razorpay_subscription_id");

-- The app may change only these columns of a user's own row. Plan and billing
-- fields change only through the SECURITY DEFINER functions below, so no code
-- path running as the user can grant itself a plan.
REVOKE UPDATE ON "users" FROM storeops_app;
GRANT UPDATE ("name", "password_hash", "session_version", "totp_secret_encrypted", "totp_enabled_at", "recovery_codes") ON "users" TO storeops_app;

-- ---- Password resets ---------------------------------------------------------
-- Only a hash of each token is stored. The app reaches this table only through
-- the two functions below: before a reset there is no signed-in user.

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
REVOKE ALL ON "password_reset_tokens" FROM storeops_app;

-- Records a reset token for the account with this email, if there is one, and
-- returns its email and name so the link can be sent. Earlier unused tokens
-- for the account stop working.
CREATE FUNCTION app_create_password_reset(p_email text, p_token_hash text, p_expires_at timestamptz)
RETURNS TABLE (email text, name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users u WHERE u.email = lower(p_email);
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE password_reset_tokens SET used_at = now() WHERE user_id = v_user.id AND used_at IS NULL;
  INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (v_user.id, p_token_hash, p_expires_at);
  RETURN QUERY SELECT v_user.email, v_user.name;
END
$$;

-- Uses a reset token once: returns the user id if it is valid and unexpired.
CREATE FUNCTION app_consume_password_reset(p_token_hash text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE password_reset_tokens SET used_at = now()
  WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
  RETURNING user_id
$$;

-- ---- Plans ---------------------------------------------------------------------

-- What an owner's plan allows and what they have used this month (UTC), for
-- the owner of the store in the current app.store_id context, or the user in
-- app.user_id. Nothing else about other owners is visible.
CREATE FUNCTION app_owner_entitlement()
RETURNS TABLE (plan text, plan_status text, trial_ends_at timestamptz, plan_renews_at timestamptz,
               plan_store_limit integer, plan_ai_allowance_inr numeric, store_count integer, month_spend_inr numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH owner AS (
    SELECT COALESCE(app_current_user_id(), (SELECT s.owner_id FROM stores s WHERE s.id = app_current_store_id())) AS id
  )
  SELECT u.plan, u.plan_status, u.trial_ends_at, u.plan_renews_at, u.plan_store_limit, u.plan_ai_allowance_inr,
    (SELECT count(*)::int FROM stores s WHERE s.owner_id = u.id),
    COALESCE((SELECT sum(g.cost_inr) FROM usage g JOIN stores s ON s.id = g.store_id
              WHERE s.owner_id = u.id AND g.month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')), 0)
  FROM users u, owner WHERE u.id = owner.id
$$;

-- The signed-in user starts a subscription checkout.
CREATE FUNCTION app_start_subscription(p_subscription_id text, p_plan text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE users SET razorpay_subscription_id = p_subscription_id,
    plan_status = CASE WHEN plan_status IN ('active', 'past_due') THEN plan_status ELSE 'pending' END
  WHERE id = app_current_user_id() AND p_plan IN ('starter', 'growth')
$$;

-- A verified billing event for a subscription. Returns whether it matched an account.
CREATE FUNCTION app_apply_subscription_event(p_subscription_id text, p_plan text, p_status text, p_renews_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE users SET
    plan = CASE WHEN p_plan IN ('starter', 'growth') THEN p_plan ELSE plan END,
    plan_status = p_status,
    plan_renews_at = COALESCE(p_renews_at, plan_renews_at)
  WHERE razorpay_subscription_id = p_subscription_id;
  RETURN FOUND;
END
$$;

-- For the operator's command line only (never granted to the app): set any plan.
CREATE FUNCTION app_admin_set_plan(p_email text, p_plan text, p_status text, p_store_limit integer, p_allowance numeric)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE users SET plan = p_plan, plan_status = p_status, plan_store_limit = p_store_limit, plan_ai_allowance_inr = p_allowance
  WHERE email = lower(p_email);
  RETURN FOUND;
END
$$;

REVOKE ALL ON FUNCTION app_create_password_reset(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_consume_password_reset(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_owner_entitlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_start_subscription(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_apply_subscription_event(text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_admin_set_plan(text, text, text, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_password_reset(text, text, timestamptz) TO storeops_app;
GRANT EXECUTE ON FUNCTION app_consume_password_reset(text) TO storeops_app;
GRANT EXECUTE ON FUNCTION app_owner_entitlement() TO storeops_app;
GRANT EXECUTE ON FUNCTION app_start_subscription(text, text) TO storeops_app;
GRANT EXECUTE ON FUNCTION app_apply_subscription_event(text, text, text, timestamptz) TO storeops_app;
