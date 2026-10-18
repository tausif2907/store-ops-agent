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
