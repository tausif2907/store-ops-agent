import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ShopifyAdapter } from "../src/shopify/adapter";
import { ShopifyClient, type ShopifyCredentials } from "../src/shopify/client";
import { mapCoupon, mapOrder, orderStatus, toMinorUnits, type RawOrder } from "../src/shopify/mappers";
import { authorizeUrl, completeOAuth, normalizeShopDomain, verifyCallbackHmac, verifyWebhookHmac } from "../src/shopify/oauth";

const SECRET = "shpss_test_secret";
const APP = { clientId: "client-123", clientSecret: SECRET };
const CREDS: ShopifyCredentials = {
  shop: "rashmi-test.myshopify.com",
  accessToken: "shpat_old",
  accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  refreshToken: "shprt_old",
  refreshTokenExpiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
  scopes: ["write_orders", "read_products", "read_inventory", "write_inventory", "read_locations", "write_discounts", "read_customers"],
};

type Handler = (body: { query: string; variables: Record<string, unknown> }, headers: Headers, url: string) => Response | Promise<Response>;

/** A scripted fetch: each call goes to the next handler. */
function fakeFetch(...handlers: Handler[]) {
  const calls: { url: string; body: { query: string; variables: Record<string, unknown> }; headers: Headers }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    const headers = new Headers(init?.headers);
    calls.push({ url, body, headers });
    const handler = handlers.shift();
    if (!handler) throw new Error(`Unexpected request to ${url}`);
    return handler(body, headers, url);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

function rawOrder(overrides: Partial<RawOrder> = {}): RawOrder {
  return {
    id: "gid://shopify/Order/1001",
    name: "RTS-1001",
    processedAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    cancelledAt: null,
    note: null,
    tags: [],
    email: "guest@example.com",
    phone: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    totalPriceSet: { shopMoney: { amount: "2500.0", currencyCode: "INR" } },
    customer: { id: "gid://shopify/Customer/1", displayName: "Meera Sharma", defaultEmailAddress: { emailAddress: "meera@example.com" }, defaultPhoneNumber: null },
    promisedAt: { value: "2026-10-10T18:30:00Z" },
    fulfillments: [],
    lineItems: {
      nodes: [{ title: "Silk Kurta", quantity: 2, originalUnitPriceSet: { shopMoney: { amount: "1250.00", currencyCode: "INR" } }, product: { id: "gid://shopify/Product/9" }, variant: { id: "gid://shopify/ProductVariant/91" } }],
    },
    ...overrides,
  };
}

describe("Shopify money and mapping", () => {
  it("converts decimal strings to minor units exactly", () => {
    expect(toMinorUnits("1250.5", "INR")).toBe(125050);
    expect(toMinorUnits("0.07", "INR")).toBe(7);
    expect(toMinorUnits("19.999", "USD")).toBe(2000);
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(toMinorUnits("-3.10", "INR")).toBe(-310);
  });

  it("maps an order, using processedAt as the business date", () => {
    const order = mapOrder(rawOrder());
    expect(order).toMatchObject({
      number: "RTS-1001",
      status: "pending",
      total: { amount: 250000, currency: "INR" },
      createdAt: "2026-10-01T10:00:00.000Z",
      promisedAt: "2026-10-10T18:30:00.000Z",
      customer: { name: "Meera Sharma", email: "meera@example.com" },
    });
    expect(order.lineItems[0]).toMatchObject({ quantity: 2, unitPrice: { amount: 125000 } });
  });

  it("derives the normalised status", () => {
    const base = rawOrder();
    expect(orderStatus({ ...base, tags: ["ops-processing"] })).toBe("processing");
    expect(orderStatus({ ...base, tags: ["ops-ready"] })).toBe("ready");
    expect(orderStatus({ ...base, displayFulfillmentStatus: "FULFILLED", tags: ["ops-ready"] })).toBe("shipped");
    expect(orderStatus({ ...base, displayFulfillmentStatus: "FULFILLED", fulfillments: [{ id: "f", displayStatus: "DELIVERED" }] })).toBe("delivered");
    expect(orderStatus({ ...base, displayFinancialStatus: "REFUNDED" })).toBe("refunded");
    expect(orderStatus({ ...base, cancelledAt: "2026-10-03T00:00:00Z", displayFinancialStatus: "REFUNDED" })).toBe("cancelled");
  });

  it("maps percent and fixed code discounts and skips the rest", () => {
    const common = { title: "X", status: "ACTIVE", startsAt: "2026-10-01T00:00:00Z", endsAt: null, usageLimit: 5, asyncUsageCount: 5 };
    expect(mapCoupon("gid://shopify/DiscountCodeNode/1", {
      __typename: "DiscountCodeBasic", ...common, codes: { nodes: [{ code: "WELCOME10" }] },
      customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 } },
    }, "INR")).toMatchObject({ code: "WELCOME10", type: "percent", value: 10, currency: null, active: false });
    expect(mapCoupon("gid://shopify/DiscountCodeNode/2", {
      __typename: "DiscountCodeBasic", ...common, usageLimit: null, codes: { nodes: [{ code: "FLAT500" }] },
      customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "500.0", currencyCode: "INR" }, appliesOnEachItem: false } },
    }, "INR")).toMatchObject({ type: "fixed", value: 50000, currency: "INR", active: true });
    expect(mapCoupon("gid://shopify/DiscountAutomaticNode/3", { __typename: "DiscountAutomaticBasic" }, "INR")).toBeNull();
  });
});

describe("Shopify OAuth", () => {
  it("normalises shop domains and rejects look-alikes", () => {
    expect(normalizeShopDomain("Rashmi-Test")).toBe("rashmi-test.myshopify.com");
    expect(normalizeShopDomain("https://rashmi-test.myshopify.com/admin")).toBe("rashmi-test.myshopify.com");
    expect(normalizeShopDomain("rashmi.myshopify.com.attacker.example")).toBeNull();
    expect(normalizeShopDomain("evil.com")).toBeNull();
  });

  it("builds the authorize URL for offline access", () => {
    const url = new URL(authorizeUrl({ shop: "rashmi-test.myshopify.com", app: APP, redirectUri: "https://ops.example/api/shopify/callback", state: "s1" }));
    expect(url.origin + url.pathname).toBe("https://rashmi-test.myshopify.com/admin/oauth/authorize");
    expect(url.searchParams.get("scope")).toContain("write_orders");
    expect(url.searchParams.has("grant_options[]")).toBe(false);
  });

  function signedCallback(params: Record<string, string>) {
    const sorted = Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    return new URLSearchParams({ ...params, hmac: createHmac("sha256", SECRET).update(sorted).digest("hex") });
  }

  it("verifies the callback signature", () => {
    const params = signedCallback({ code: "abc", shop: "rashmi-test.myshopify.com", state: "s1", timestamp: "1700000000" });
    expect(verifyCallbackHmac(params, SECRET)).toBe(true);
    params.set("shop", "other.myshopify.com");
    expect(verifyCallbackHmac(params, SECRET)).toBe(false);
  });

  it("exchanges the code for expiring tokens after checking state, signature and age", async () => {
    const params = signedCallback({ code: "abc", shop: "rashmi-test.myshopify.com", state: "s1", timestamp: String(Math.floor(Date.now() / 1000)) });
    const { impl, calls } = fakeFetch(() =>
      json({ access_token: "shpat_new", scope: "write_orders,read_products", expires_in: 3600, refresh_token: "shprt_new", refresh_token_expires_in: 7_776_000 }),
    );
    const result = await completeOAuth({ params, expectedState: "s1", app: APP, fetch: impl });
    expect(result.ok).toBe(true);
    expect(calls[0]!.url).toBe("https://rashmi-test.myshopify.com/admin/oauth/access_token");
    expect(calls[0]!.body).toMatchObject({ code: "abc", expiring: "1", client_id: "client-123" });
    if (result.ok) {
      expect(result.credentials).toMatchObject({ accessToken: "shpat_new", refreshToken: "shprt_new" });
      expect(result.missingScopes).toContain("write_discounts");
      expect(result.missingScopes).not.toContain("read_orders"); // implied by write_orders
    }

    expect((await completeOAuth({ params, expectedState: "other", app: APP, fetch: impl })).ok).toBe(false);
    const stale = signedCallback({ code: "abc", shop: "rashmi-test.myshopify.com", state: "s1", timestamp: "1700000000" });
    expect((await completeOAuth({ params: stale, expectedState: "s1", app: APP, fetch: impl })).ok).toBe(false);
  });

  it("verifies webhook signatures over the raw body", () => {
    const body = JSON.stringify({ id: 1 });
    const hmac = createHmac("sha256", SECRET).update(body).digest("base64");
    expect(verifyWebhookHmac(body, hmac, SECRET)).toBe(true);
    expect(verifyWebhookHmac(body + " ", hmac, SECRET)).toBe(false);
    expect(verifyWebhookHmac(body, null, SECRET)).toBe(false);
  });
});

describe("Shopify client", () => {
  const shopData = { data: { shop: { id: "gid://shopify/Shop/1", name: "Rashmi", currencyCode: "INR", ianaTimezone: "Asia/Kolkata", myshopifyDomain: CREDS.shop } } };

  it("refreshes an expiring token before the request and reports the new tokens", async () => {
    const saved: ShopifyCredentials[] = [];
    const { impl, calls } = fakeFetch(
      () => json({ access_token: "shpat_new", scope: "write_orders", expires_in: 3600, refresh_token: "shprt_new", refresh_token_expires_in: 7_776_000 }),
      (_b, headers) => {
        expect(headers.get("x-shopify-access-token")).toBe("shpat_new");
        return json(shopData);
      },
    );
    const client = new ShopifyClient(
      { ...CREDS, accessTokenExpiresAt: new Date(Date.now() + 10_000).toISOString() },
      { app: APP, fetch: impl, sleep: noSleep, onCredentialsChange: (c) => void saved.push(c) },
    );
    await client.request("query { shop { name } }");
    expect(calls[0]!.body).toMatchObject({ grant_type: "refresh_token", refresh_token: "shprt_old" });
    expect(saved[0]).toMatchObject({ accessToken: "shpat_new", refreshToken: "shprt_new" });
  });

  it("refreshes once on a 401, then gives up with AUTH", async () => {
    const { impl } = fakeFetch(
      () => new Response("", { status: 401 }),
      () => json({ access_token: "shpat_new", scope: "", expires_in: 3600, refresh_token: "shprt_new", refresh_token_expires_in: 100 }),
      () => new Response("", { status: 401 }),
    );
    const client = new ShopifyClient(CREDS, { app: APP, fetch: impl, sleep: noSleep });
    await expect(client.request("query { shop { name } }")).rejects.toMatchObject({ code: "AUTH" });
  });

  it("uses tokens another process already refreshed", async () => {
    const fresh = { ...CREDS, accessToken: "shpat_other", accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    const { impl, calls } = fakeFetch((_b, headers) => {
      expect(headers.get("x-shopify-access-token")).toBe("shpat_other");
      return json(shopData);
    });
    const client = new ShopifyClient(
      { ...CREDS, accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString() },
      { app: APP, fetch: impl, sleep: noSleep, reloadCredentials: async () => fresh },
    );
    await client.request("query { shop { name } }");
    expect(calls).toHaveLength(1);
  });

  it("waits out GraphQL throttling and HTTP 429", async () => {
    const waits: number[] = [];
    const { impl } = fakeFetch(
      () => json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: { requestedQueryCost: 200, throttleStatus: { currentlyAvailable: 100, restoreRate: 100 } } } }),
      () => new Response("", { status: 429, headers: { "retry-after": "2" } }),
      () => json(shopData),
    );
    const client = new ShopifyClient(CREDS, { app: APP, fetch: impl, sleep: async (ms) => void waits.push(ms) });
    await client.request("query { shop { name } }");
    expect(waits).toEqual([1000, 2000]);
  });

  it("reports missing access as AUTH", async () => {
    const { impl } = fakeFetch(() => json({ errors: [{ message: "Access denied for customer field", extensions: { code: "ACCESS_DENIED" } }] }));
    const client = new ShopifyClient(CREDS, { app: APP, fetch: impl, sleep: noSleep });
    await expect(client.request("query { shop { name } }")).rejects.toMatchObject({ code: "AUTH" });
  });
});

describe("Shopify adapter", () => {
  const edge = (o: RawOrder) => ({ cursor: `c-${o.id}`, node: o });

  it("declares capabilities from the granted scopes; never reviews", async () => {
    const adapter = new ShopifyAdapter({ ...CREDS, scopes: ["read_orders", "read_products", "read_inventory"] }, { app: APP });
    expect(await adapter.capabilities()).toEqual(["orders", "inventory"]);
    await expect(adapter.listReviews()).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(adapter.createCoupon({ code: "NOPE10", type: "percent", value: 10 })).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const withHooks = new ShopifyAdapter(CREDS, { app: APP, webhookUrl: "https://ops.example/api/webhooks/shopify" });
    expect(await withHooks.capabilities()).toContain("webhooks");
  });

  it("filters statuses Shopify cannot search, and resumes from the last returned item", async () => {
    const orders = [
      rawOrder({ id: "gid://shopify/Order/1", tags: ["ops-processing"] }),
      rawOrder({ id: "gid://shopify/Order/2" }),
      rawOrder({ id: "gid://shopify/Order/3", tags: ["ops-processing"] }),
      rawOrder({ id: "gid://shopify/Order/4", tags: ["ops-processing"] }),
    ];
    const { impl, calls } = fakeFetch(() => json({ data: { orders: { edges: orders.map(edge), pageInfo: { hasNextPage: false } } } }));
    const adapter = new ShopifyAdapter(CREDS, { app: APP, fetch: impl, sleep: noSleep });
    const page = await adapter.listOrders({ status: "processing", limit: 2, createdFrom: "2026-09-01T00:00:00.000Z" });
    expect(page.items.map((o) => o.id)).toEqual(["gid://shopify/Order/1", "gid://shopify/Order/3"]);
    expect(page.nextCursor).toBe("c-gid://shopify/Order/3");
    expect(calls[0]!.body.variables.query).toBe("processed_at:>='2026-09-01T00:00:00.000Z'");
  });

  it("treats ids that are not Shopify ids as not found, without calling Shopify", async () => {
    const adapter = new ShopifyAdapter(CREDS, { app: APP, fetch: fakeFetch().impl });
    await expect(adapter.getOrder("999999999")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(adapter.getProductByVariant("abc")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("moves an order to processing with tags, and keeps cancelling in Shopify admin", async () => {
    const pending = rawOrder();
    const processing = rawOrder({ tags: ["ops-processing"] });
    const { impl, calls } = fakeFetch(
      () => json({ data: { order: pending } }),
      () => json({ data: { tagsRemove: { userErrors: [] } } }),
      () => json({ data: { tagsAdd: { userErrors: [] } } }),
      () => json({ data: { order: processing } }),
      () => json({ data: { order: processing } }),
    );
    const adapter = new ShopifyAdapter(CREDS, { app: APP, fetch: impl, sleep: noSleep });
    expect((await adapter.updateOrderStatus(pending.id, "processing")).status).toBe("processing");
    expect(calls[2]!.body.variables).toEqual({ id: pending.id, tags: ["ops-processing"] });
    await expect(adapter.updateOrderStatus(pending.id, "cancelled")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("reports a taken coupon code as CONFLICT and rejects over-100% before calling Shopify", async () => {
    const { impl } = fakeFetch(
      () => json(shopData()),
      () => json({ data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ code: "TAKEN", field: ["basicCodeDiscount", "code"], message: "Code must be unique" }] } } }),
    );
    const adapter = new ShopifyAdapter(CREDS, { app: APP, fetch: impl, sleep: noSleep });
    await expect(adapter.createCoupon({ code: "WELCOME10", type: "percent", value: 10 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(adapter.createCoupon({ code: "TOOMUCH", type: "percent", value: 150 })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("sets stock with compare-and-set at the first active location", async () => {
    const { impl, calls } = fakeFetch(
      () => json({ data: { productVariant: { inventoryQuantity: 7, inventoryItem: { id: "gid://shopify/InventoryItem/5", tracked: true, inventoryLevels: { nodes: [
        { location: { id: "gid://shopify/Location/1", isActive: true }, quantities: [{ name: "available", quantity: 4 }] },
        { location: { id: "gid://shopify/Location/2", isActive: true }, quantities: [{ name: "available", quantity: 3 }] },
      ] } } } } }),
      () => json({ data: { inventorySetQuantities: { userErrors: [] } } }),
      () => json({ data: { productVariant: { product: { id: "gid://shopify/Product/9", title: "Kurta", status: "ACTIVE", updatedAt: "2026-10-01T00:00:00Z", variants: { nodes: [] } } } } }),
      () => json(shopData()),
    );
    const adapter = new ShopifyAdapter(CREDS, { app: APP, fetch: impl, sleep: noSleep });
    await adapter.updateStock("gid://shopify/ProductVariant/91", 10);
    const input = calls[1]!.body.variables.input as { quantities: { quantity: number; changeFromQuantity: number }[] };
    // Total 7 → 10: +3 at the first location (4 → 7).
    expect(input.quantities[0]).toMatchObject({ quantity: 7, changeFromQuantity: 4 });
    expect(calls[1]!.body.query).toContain("@idempotent");
  });

  function shopData() {
    return { data: { shop: { id: "gid://shopify/Shop/1", name: "Rashmi", currencyCode: "INR", ianaTimezone: "Asia/Kolkata", myshopifyDomain: CREDS.shop } } };
  }
});
