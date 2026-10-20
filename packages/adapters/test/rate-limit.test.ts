import { afterEach, describe, expect, it } from "vitest";
import { CustomRestAdapter } from "../src/custom-rest/adapter";
import { TokenBucket, backoffDelay, bucketFor, parseRetryAfter, resetBuckets, type Clock } from "../src/rate-limit";
import { WooClient } from "../src/woocommerce/client";

function fakeClock(waits: number[] = []): Clock & { waits: number[] } {
  let t = 1_000_000;
  return { waits, now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } };
}

afterEach(() => resetBuckets());

describe("token bucket", () => {
  it("allows a burst, then paces requests at the refill rate", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(3, 2, clock); // burst 3, 2 per second
    for (let i = 0; i < 3; i++) expect(await bucket.take()).toBe(0);
    expect(await bucket.take()).toBe(500);
    expect(await bucket.take()).toBe(500);
  });

  it("re-syncs to the platform's own numbers", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket(2000, 100, clock);
    bucket.sync(100, 1000, 50);
    expect(bucket.waitTime(200)).toBe(2000);
    expect(bucket.waitTime(5000)).toBe(18_000); // never asks for more than the bucket can hold
  });

  it("is shared per key, so every adapter for one store draws from it", () => {
    expect(bucketFor("woo:a", 10, 5)).toBe(bucketFor("woo:a", 99, 99));
    expect(bucketFor("woo:a", 10, 5)).not.toBe(bucketFor("woo:b", 10, 5));
  });
});

describe("backoff", () => {
  it("prefers Retry-After, capped", () => {
    expect(backoffDelay(0, 3000)).toBe(3000);
    expect(backoffDelay(0, 600_000)).toBe(60_000);
  });

  it("grows exponentially with full jitter, capped", () => {
    expect(backoffDelay(0, null, { random: () => 1 })).toBe(550);
    expect(backoffDelay(3, null, { random: () => 1 })).toBe(4050);
    expect(backoffDelay(10, null, { random: () => 1 })).toBe(8050);
    expect(backoffDelay(10, null, { random: () => 0 })).toBe(50);
  });

  it("reads Retry-After as seconds or an HTTP date", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("platform clients", () => {
  const ok = (body: unknown = []) => new Response(JSON.stringify(body), { status: 200 });

  it("WooCommerce paces bursts and honours Retry-After on 429", async () => {
    const clock = fakeClock();
    process.env.WOO_REQUESTS_PER_SECOND = "2";
    const responses = [new Response("{}", { status: 429, headers: { "retry-after": "3" } }), ok(), ok(), ok(), ok(), ok()];
    const client = new WooClient(
      { url: "https://pace.example.com", consumerKey: "ck_a", consumerSecret: "cs_b", webhookSecret: null },
      { clock, fetch: (async () => responses.shift()!) as unknown as typeof fetch },
    );
    for (let i = 0; i < 5; i++) await client.get("/orders");
    delete process.env.WOO_REQUESTS_PER_SECOND;
    expect(clock.waits[0]).toBe(3000);
    // Burst of 4 (2 × rate), then the 6th request waits for a token.
    expect(clock.waits.slice(1)).toEqual([500]);
  });

  it("the custom connector retries a 429 and gives up with RATE_LIMITED", async () => {
    const clock = fakeClock();
    const busy = () => new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Slow down" } }), { status: 429, headers: { "retry-after": "1" } });
    const adapter = new CustomRestAdapter(
      { baseUrl: "https://busy.example.com/store-ops/v1", apiKey: "k".repeat(20) },
      { clock, maxRetries: 2, fetch: (async () => busy()) as unknown as typeof fetch },
    );
    await expect(adapter.capabilities()).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 1000 });
    expect(clock.waits).toEqual([1000, 1000]);
  });
});
