-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "external_id" TEXT;

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_store_id_received_at_idx" ON "webhook_events"("store_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_store_id_delivery_id_key" ON "webhook_events"("store_id", "delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "stores_platform_external_id_key" ON "stores"("platform", "external_id");

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Webhook events belong to their store, like every tenant table.
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_tenant ON "webhook_events"
  USING (store_id IN (SELECT id FROM stores))
  WITH CHECK (store_id IN (SELECT id FROM stores));
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_events" TO storeops_app;

-- Webhooks arrive with only the platform's store id (e.g. a Shopify domain).
-- This returns the matching store id and nothing else, so the receiver can
-- then work in that store's context.
CREATE FUNCTION app_store_for_external(p_platform "Platform", p_external_id text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM stores WHERE platform = p_platform AND external_id = p_external_id
$$;

REVOKE ALL ON FUNCTION app_store_for_external("Platform", text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_store_for_external("Platform", text) TO storeops_app;
