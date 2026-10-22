import pg from "pg";
import { describe, expect, it } from "vitest";
import { SupabaseAdapter } from "../src/supabase/adapter";
import { resetBoutique } from "../src/supabase/seed";
import { defineConformanceSuite } from "../src/testing/conformance";

const ADMIN_URL = process.env.BOUTIQUE_ADMIN_URL!;
const AGENT_URL = process.env.BOUTIQUE_AGENT_URL!;

defineConformanceSuite({
  name: "supabase",
  reset: (dataset) => resetBoutique(ADMIN_URL, dataset),
  createAdapter: () => new SupabaseAdapter({ connectionString: AGENT_URL }),
});

describe("supabase agent_role is restricted", () => {
  it("cannot read store tables directly", async () => {
    const client = new pg.Client({ connectionString: AGENT_URL });
    await client.connect();
    try {
      for (const table of ["orders", "customers", "products", "coupons", "reviews"]) {
        await expect(client.query(`SELECT * FROM public.${table} LIMIT 1`)).rejects.toThrow(/permission denied/);
      }
      await expect(client.query("SELECT agent_api.order_json(gen_random_uuid())")).rejects.toThrow(/permission denied/);
    } finally {
      await client.end();
    }
  });

  it("reports bad credentials as AUTH", async () => {
    const adapter = new SupabaseAdapter({ connectionString: AGENT_URL.replace("agent_role:agent_role", "agent_role:wrong") });
    await expect(adapter.listCoupons()).rejects.toMatchObject({ code: "AUTH" });
    await adapter.close();
  });
});

describe("supabase capabilities", () => {
  async function asAdmin(sql: string) {
    const client = new pg.Client({ connectionString: ADMIN_URL });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  it("are all eight when the store's agent_api does not declare them", async () => {
    await resetBoutique(ADMIN_URL);
    const adapter = new SupabaseAdapter({ connectionString: AGENT_URL });
    expect(await adapter.capabilities()).toEqual(["orders", "orders.write", "inventory", "inventory.write", "coupons", "coupons.write", "reviews", "reviews.write"]);
    await adapter.close();
  });

  it("follow agent_api.capabilities() when the store declares them", async () => {
    await asAdmin(`
      CREATE FUNCTION agent_api.capabilities() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT '["orders", "inventory", "reviews"]'::jsonb $$;
      GRANT EXECUTE ON FUNCTION agent_api.capabilities() TO agent_role;`);
    const adapter = new SupabaseAdapter({ connectionString: AGENT_URL });
    try {
      expect(await adapter.capabilities()).toEqual(["orders", "inventory", "reviews"]);
    } finally {
      await adapter.close();
      await asAdmin("DROP FUNCTION agent_api.capabilities()");
    }
  });

  it("reject a declaration with an unknown capability", async () => {
    await asAdmin(`
      CREATE FUNCTION agent_api.capabilities() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT '["orders", "refunds"]'::jsonb $$;
      GRANT EXECUTE ON FUNCTION agent_api.capabilities() TO agent_role;`);
    const adapter = new SupabaseAdapter({ connectionString: AGENT_URL });
    try {
      await expect(adapter.capabilities()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    } finally {
      await adapter.close();
      await asAdmin("DROP FUNCTION agent_api.capabilities()");
    }
  });
});
