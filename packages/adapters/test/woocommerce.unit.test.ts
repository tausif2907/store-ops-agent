import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { htmlToText, mapCoupon, orderStatus } from "../src/woocommerce/adapter";
import { WooClient, verifyWooWebhook, wooOAuthSignature } from "../src/woocommerce/client";

describe("WooCommerce OAuth 1.0a signing", () => {
  it("matches the signature WooCommerce's own PHP computes", () => {
    // Expected value computed inside WooCommerce 11.2 with WC_REST_Authentication's algorithm.
    const signature = wooOAuthSignature(
      "GET",
      "http://localhost:8080/wp-json/wc/v3/orders",
      { per_page: "1", oauth_consumer_key: "ck_x", oauth_nonce: "abc", oauth_signature_method: "HMAC-SHA256", oauth_timestamp: "1700000000" },
      "cs_y",
    );
    expect(signature).toBe("zCR8EzuY85FWrpfi7B7uh/Nu4CxFLms+dS9ocM6q+Fs=");
  });

  it("uses Basic auth over HTTPS and OAuth over HTTP", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    const creds = { consumerKey: "ck_abc", consumerSecret: "cs_def", webhookSecret: null };
    await new WooClient({ ...creds, url: "https://shop.example.com/" }, { fetch: fetchImpl }).get("/orders", { per_page: 1 });
    await new WooClient({ ...creds, url: "http://localhost:8080" }, { fetch: fetchImpl }).get("/orders", { per_page: 1 });
    expect(seen[0]!.url).toBe("https://shop.example.com/wp-json/wc/v3/orders?per_page=1");
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from("ck_abc:cs_def").toString("base64")}`);
    expect(seen[1]!.auth).toBeNull();
    expect(seen[1]!.url).toMatch(/oauth_signature=/);
    expect(seen[1]!.url).not.toContain("cs_def");
  });

  it("maps WooCommerce errors to adapter errors", async () => {
    const reply = (status: number, body: unknown) =>
      (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const client = (status: number, body: unknown) =>
      new WooClient({ url: "https://s.example.com", consumerKey: "ck_a", consumerSecret: "cs_b", webhookSecret: null }, { fetch: reply(status, body), maxRetries: 0 });
    await expect(client(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID." }).get("/orders/9")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client(400, { code: "woocommerce_rest_coupon_code_already_exists", message: "Exists" }).get("/coupons")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(client(401, { code: "woocommerce_rest_cannot_view", message: "No" }).get("/orders")).rejects.toMatchObject({ code: "AUTH" });
    await expect(client(400, { code: "rest_invalid_param", message: "Bad" }).get("/orders")).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("WooCommerce mapping", () => {
  const order = (status: string, opsStatus?: string) => ({ status, meta_data: opsStatus ? [{ key: "store_ops_status", value: opsStatus }] : [] });

  it("maps statuses, using order meta for states WooCommerce lacks", () => {
    expect(orderStatus(order("pending"))).toBe("pending");
    expect(orderStatus(order("on-hold"))).toBe("pending");
    expect(orderStatus(order("processing"))).toBe("processing");
    expect(orderStatus(order("processing", "ready"))).toBe("ready");
    expect(orderStatus(order("completed"))).toBe("shipped");
    expect(orderStatus(order("completed", "delivered"))).toBe("delivered");
    expect(orderStatus(order("failed"))).toBe("cancelled");
    expect(orderStatus(order("refunded", "ready"))).toBe("refunded");
  });

  it("turns review HTML into text", () => {
    expect(htmlToText("<p>Loved it &amp; the fit&#8217;s great.</p>\n")).toBe("Loved it & the fit’s great.");
    expect(htmlToText("<p>One</p>\n<p>Two<br />three</p>")).toBe("One\n\nTwo\nthree");
  });

  it("maps coupons: codes upper-cased, expired or used-up ones inactive", () => {
    const base = { id: 1, status: "publish", usage_count: 0, usage_limit: null, date_created_gmt: "2026-10-01T00:00:00", date_expires_gmt: null };
    expect(mapCoupon({ ...base, code: "welcome10", discount_type: "percent", amount: "10.00" }, "INR")).toMatchObject({
      code: "WELCOME10", type: "percent", value: 10, currency: null, active: true,
    });
    expect(mapCoupon({ ...base, code: "flat500", discount_type: "fixed_cart", amount: "500.00", usage_count: 5, usage_limit: 5 }, "INR")).toMatchObject({
      type: "fixed", value: 50000, currency: "INR", active: false,
    });
    expect(mapCoupon({ ...base, code: "old", discount_type: "percent", amount: "5", date_expires_gmt: "2020-01-01T00:00:00" }, "INR")?.active).toBe(false);
    expect(mapCoupon({ ...base, code: "item", discount_type: "fixed_product", amount: "5" }, "INR")).toBeNull();
  });
});

describe("WooCommerce webhook signatures", () => {
  it("accepts the right secret only", () => {
    const body = JSON.stringify({ id: 42 });
    const signature = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(verifyWooWebhook(body, signature, "s3cret")).toBe(true);
    expect(verifyWooWebhook(body, signature, "other")).toBe(false);
    expect(verifyWooWebhook(body, null, "s3cret")).toBe(false);
  });
});
