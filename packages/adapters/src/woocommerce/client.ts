import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AdapterError, type AdapterErrorCode } from "../adapter";
import { backoffDelay, bucketFor, parseRetryAfter, platformRate, realClock, type Clock } from "../rate-limit";

/**
 * Minimal WooCommerce REST API (v3) client.
 *
 * Authentication follows WooCommerce: HTTP Basic with the consumer key and
 * secret over HTTPS, and one-legged OAuth 1.0a (HMAC-SHA256) over plain HTTP,
 * which WooCommerce requires so keys never travel in the clear.
 */

export const WooCredentials = z.object({
  /** The site's home URL, e.g. https://shop.example.com */
  url: z.string().url().transform((u) => u.replace(/\/+$/, "")),
  consumerKey: z.string().startsWith("ck_"),
  consumerSecret: z.string().startsWith("cs_"),
  /** Secret WooCommerce signs webhook deliveries with; set when webhooks are subscribed. */
  webhookSecret: z.string().nullable().default(null),
});
export type WooCredentials = z.infer<typeof WooCredentials>;

export interface WooClientOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  maxRetries?: number;
}

export interface WooResponse<T> {
  data: T;
  total: number | null;
  totalPages: number | null;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** RFC 3986 encoding, as PHP's rawurlencode. */
function rawurlencode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The OAuth 1.0a signature WooCommerce checks (WC_REST_Authentication):
 * sort by raw key, encode key and value, then encode each "key=value" pair
 * again and join the pairs with %26.
 */
export function wooOAuthSignature(method: string, url: string, params: Record<string, string>, consumerSecret: string): string {
  const pairs = Object.keys(params)
    .sort()
    .map((k) => rawurlencode(`${rawurlencode(k)}=${rawurlencode(params[k]!)}`));
  const base = `${method.toUpperCase()}&${rawurlencode(url)}&${pairs.join("%26")}`;
  return createHmac("sha256", `${consumerSecret}&`).update(base).digest("base64");
}

export class WooClient {
  readonly credentials: WooCredentials;
  private readonly options: WooClientOptions;

  constructor(credentials: WooCredentials, options: WooClientOptions = {}) {
    this.credentials = WooCredentials.parse(credentials);
    this.options = options;
  }

  get(path: string, query: Query = {}) {
    return this.request<unknown>("GET", path, query);
  }

  async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, query: Query = {}, body?: unknown): Promise<WooResponse<T>> {
    const fetchImpl = this.options.fetch ?? fetch;
    const clock = this.options.clock ?? realClock;
    const maxRetries = this.options.maxRetries ?? 3;
    // WooCommerce has no published limit, but hosts do: stay at a polite rate per site.
    const rate = platformRate("WOO_REQUESTS_PER_SECOND", 5);
    const bucket = bucketFor(`woo:${this.credentials.url}`, rate * 2, rate, clock);

    for (let attempt = 0; ; attempt++) {
      await bucket.take();
      const { url, headers } = this.sign(method, path, query);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method,
          headers: { ...headers, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await clock.sleep(backoffDelay(attempt));
          continue;
        }
        throw new AdapterError("UNAVAILABLE", `Could not reach ${this.credentials.url}`, { cause: err, retryAfterMs: 5_000 });
      }

      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await clock.sleep(backoffDelay(attempt, parseRetryAfter(res.headers.get("retry-after"), clock.now())));
        continue;
      }

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // WordPress sometimes prints HTML (maintenance mode, a PHP error page).
        throw new AdapterError(res.ok ? "INVALID_RESPONSE" : "UNAVAILABLE", `WooCommerce returned non-JSON (${res.status})`);
      }
      if (!res.ok) throw toAdapterError(res.status, json);
      return {
        data: json as T,
        total: res.headers.has("x-wp-total") ? Number(res.headers.get("x-wp-total")) : null,
        totalPages: res.headers.has("x-wp-totalpages") ? Number(res.headers.get("x-wp-totalpages")) : null,
      };
    }
  }

  private sign(method: string, path: string, query: Query): { url: string; headers: Record<string, string> } {
    const base = `${this.credentials.url}/wp-json/wc/v3${path}`;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) params[k] = String(v);

    if (base.startsWith("https://")) {
      const basic = Buffer.from(`${this.credentials.consumerKey}:${this.credentials.consumerSecret}`).toString("base64");
      return { url: withQuery(base, params), headers: { authorization: `Basic ${basic}` } };
    }
    const oauth: Record<string, string> = {
      ...params,
      oauth_consumer_key: this.credentials.consumerKey,
      oauth_nonce: randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    };
    oauth.oauth_signature = wooOAuthSignature(method, base, oauth, this.credentials.consumerSecret);
    return { url: withQuery(base, oauth), headers: {} };
  }
}

function withQuery(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${rawurlencode(k)}=${rawurlencode(v)}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}

function toAdapterError(status: number, body: unknown): AdapterError {
  const { code = "", message = `WooCommerce returned ${status}` } = (body ?? {}) as { code?: string; message?: string };
  let kind: AdapterErrorCode;
  if (status === 401 || status === 403) kind = "AUTH";
  else if (status === 404 || /invalid_id|_not_found/.test(code)) kind = "NOT_FOUND";
  else if (/already_exists|_exists$|duplicate/.test(code)) kind = "CONFLICT";
  else if (status === 400 || status === 422) kind = "VALIDATION";
  else if (status === 429) kind = "RATE_LIMITED";
  else kind = "UNAVAILABLE";
  return new AdapterError(kind, `${message}${code ? ` (${code})` : ""}`);
}

/** Verifies X-WC-Webhook-Signature: base64 HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWooWebhook(rawBody: string | Buffer, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("base64"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
