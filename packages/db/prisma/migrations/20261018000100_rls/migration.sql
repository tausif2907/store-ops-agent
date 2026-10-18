-- Row-Level Security for every tenant-owned table.
--
-- The app connects as `storeops_app` (not the table owner) and sets one of:
--   app.user_id  — dashboard requests: rows of stores this user owns
--   app.store_id — agent runs / jobs: rows of exactly this store
-- with set_config(..., is_local => true) inside each transaction.
-- FORCE ROW LEVEL SECURITY makes the policies apply to the table owner too.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storeops_app') THEN
    CREATE ROLE storeops_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO storeops_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO storeops_app;
REVOKE ALL ON "_prisma_migrations" FROM storeops_app;
-- Users are only reachable through the auth functions below and their own row.
REVOKE INSERT, DELETE ON "users" FROM storeops_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storeops_app;

-- ---- Context helpers ------------------------------------------------------

CREATE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION app_current_store_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.store_id', true), '')::uuid
$$;

-- ---- users ----------------------------------------------------------------

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY users_self ON "users"
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

-- Auth runs before any user context exists. These SECURITY DEFINER functions
-- expose only what sign-up and login need.
CREATE FUNCTION app_find_user_for_login(p_email text)
RETURNS TABLE (id uuid, name text, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.name, u.password_hash FROM users u WHERE u.email = lower(p_email)
$$;

CREATE FUNCTION app_create_user(p_email text, p_name text, p_password_hash text)
RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO users (id, email, name, password_hash)
  VALUES (gen_random_uuid(), lower(p_email), p_name, p_password_hash)
  RETURNING id
$$;

REVOKE ALL ON FUNCTION app_find_user_for_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_create_user(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_find_user_for_login(text) TO storeops_app;
GRANT EXECUTE ON FUNCTION app_create_user(text, text, text) TO storeops_app;

-- ---- stores ---------------------------------------------------------------

ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;
CREATE POLICY stores_tenant ON "stores"
  USING (owner_id = app_current_user_id() OR id = app_current_store_id())
  WITH CHECK (owner_id = app_current_user_id() OR id = app_current_store_id());

-- ---- tables carrying store_id ----------------------------------------------
-- Visible when their store is visible (the subquery is itself RLS-filtered).

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_connections', 'policies', 'jobs', 'agent_runs', 'audit_log', 'usage']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (store_id IN (SELECT id FROM stores)) WITH CHECK (store_id IN (SELECT id FROM stores))',
      t || '_tenant', t);
  END LOOP;
END
$$;

-- ---- tables scoped through their run ---------------------------------------

ALTER TABLE "tool_calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tool_calls" FORCE ROW LEVEL SECURITY;
CREATE POLICY tool_calls_tenant ON "tool_calls"
  USING (run_id IN (SELECT id FROM agent_runs))
  WITH CHECK (run_id IN (SELECT id FROM agent_runs));

ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY approvals_tenant ON "approvals"
  USING (tool_call_id IN (SELECT id FROM tool_calls))
  WITH CHECK (tool_call_id IN (SELECT id FROM tool_calls));

-- The audit log is append-only for the app role.
REVOKE UPDATE, DELETE ON "audit_log" FROM storeops_app;
