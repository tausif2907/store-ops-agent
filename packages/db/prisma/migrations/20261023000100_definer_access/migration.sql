-- The SECURITY DEFINER functions (sign-up, login lookup, owner contact,
-- webhook store lookup, the worker's store list, password resets, plans) run
-- as the role that owns the tables. FORCE ROW LEVEL SECURITY applies the
-- tenant policies to that role too, and on managed Postgres the owner is not a
-- superuser, so those functions saw nothing and could insert nothing (sign-up
-- failed with "new row violates row-level security policy").
--
-- This lets the owning role, the one running these migrations, through every
-- tenant table. The app connects as storeops_app, which these policies do not
-- name, so its access is unchanged: it still sees only its own tenant's rows.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'stores', 'store_connections', 'policies', 'jobs', 'agent_runs', 'audit_log', 'usage',
                           'tool_calls', 'approvals', 'webhook_events', 'drafts', 'password_reset_tokens']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I TO %I USING (true) WITH CHECK (true)', t || '_definer', t, current_user);
  END LOOP;
END
$$;
