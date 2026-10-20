-- CreateEnum
CREATE TYPE "DraftKind" AS ENUM ('CUSTOMER_MESSAGE', 'REVIEW_REPLY');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'SENT', 'POSTED', 'DISMISSED');

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "job_type" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "state" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "drafts" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "run_id" UUID,
    "kind" "DraftKind" NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_label" TEXT NOT NULL,
    "recipient" JSONB,
    "body" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drafts_store_id_status_created_at_idx" ON "drafts"("store_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "drafts_store_id_kind_target_id_idx" ON "drafts"("store_id", "kind", "target_id");

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Drafts belong to their store, like every tenant table.
ALTER TABLE "drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY drafts_tenant ON "drafts"
  USING (store_id IN (SELECT id FROM stores))
  WITH CHECK (store_id IN (SELECT id FROM stores));
GRANT SELECT, INSERT, UPDATE, DELETE ON "drafts" TO storeops_app;

-- The job worker serves every store but works inside one store's context at a
-- time. These return store ids only; everything else is read per store.
CREATE FUNCTION app_connected_store_ids()
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM stores s JOIN store_connections c ON c.store_id = s.id WHERE c.status = 'ACTIVE'
$$;

CREATE FUNCTION app_stores_with_pending_webhooks()
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT store_id FROM webhook_events WHERE processed_at IS NULL
$$;

REVOKE ALL ON FUNCTION app_connected_store_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_stores_with_pending_webhooks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_connected_store_ids() TO storeops_app;
GRANT EXECUTE ON FUNCTION app_stores_with_pending_webhooks() TO storeops_app;
