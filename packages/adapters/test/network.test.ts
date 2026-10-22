import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CustomRestAdapter } from "../src/custom-rest/adapter";
import { assertPublicHost, isPrivateAddress } from "../src/network";
import { SupabaseAdapter } from "../src/supabase/adapter";
import { WooAdapter } from "../src/woocommerce/adapter";

/** Owners cannot point the app at our own network (SSRF). */
describe("store addresses", () => {
  const saved = process.env.ALLOW_PRIVATE_STORE_HOSTS;
  beforeEach(() => {
    delete process.env.ALLOW_PRIVATE_STORE_HOSTS;
  });
  afterEach(() => {
    process.env.ALLOW_PRIVATE_STORE_HOSTS = saved;
  });

  it("recognises private, loopback, link-local and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "203.0.113.10", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses internal names and addresses", async () => {
    for (const host of ["localhost", "api.localhost", "metadata.google.internal", "printer.local", "127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.5"]) {
      await expect(assertPublicHost(host), host).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("refuses a custom connector, WooCommerce site or database on a private address before connecting", async () => {
    let called = false;
    const fetchSpy = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    const custom = new CustomRestAdapter({ baseUrl: "http://127.0.0.1:3201/mcp", apiKey: "k".repeat(20) }, { fetch: fetchSpy });
    await expect(custom.capabilities()).rejects.toMatchObject({ code: "VALIDATION" });
    const woo = new WooAdapter({ url: "http://169.254.169.254", consumerKey: "ck_x", consumerSecret: "cs_x", webhookSecret: null }, { fetch: fetchSpy });
    await expect(woo.listOrders()).rejects.toMatchObject({ code: "VALIDATION" });
    expect(called).toBe(false);

    const db = new SupabaseAdapter({ connectionString: "postgresql://u:p@localhost:5433/storeops" });
    await expect(db.listCoupons()).rejects.toMatchObject({ code: "VALIDATION" });
    const sneaky = new SupabaseAdapter({ connectionString: "postgresql://u:p@db.example.com/x?host=/var/run/postgresql" });
    await expect(sneaky.listCoupons()).rejects.toMatchObject({ code: "VALIDATION" });
    await Promise.all([db.close(), sneaky.close()]);
  });

  it("does not follow a redirect from a store", async () => {
    process.env.ALLOW_PRIVATE_STORE_HOSTS = "1"; // the address itself is fine here; the redirect is the point
    const redirecting = (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })) as typeof fetch;
    const custom = new CustomRestAdapter({ baseUrl: "https://shop.example.com/store-ops/v1", apiKey: "k".repeat(20) }, { fetch: redirecting });
    await expect(custom.capabilities()).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("redirected") });
  });
});
