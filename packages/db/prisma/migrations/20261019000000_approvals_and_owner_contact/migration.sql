-- Approval outcomes, and the reason an Auto call fell back to approval.
ALTER TABLE "approvals" ADD COLUMN "reason" TEXT;
ALTER TABLE "approvals" ADD COLUMN "result" JSONB;
ALTER TABLE "approvals" ADD COLUMN "error" TEXT;

-- The owner's name and email for the store in the current app.store_id
-- context, so the agent side can email approval links without reading users.
CREATE FUNCTION app_store_owner_contact()
RETURNS TABLE (email text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.email, u.name
  FROM stores s JOIN users u ON u.id = s.owner_id
  WHERE s.id = app_current_store_id()
$$;

REVOKE ALL ON FUNCTION app_store_owner_contact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_store_owner_contact() TO storeops_app;
