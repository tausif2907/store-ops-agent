import { z } from "zod";
import { AdapterError } from "../adapter";
import { backoffDelay, bucketFor, parseRetryAfter, realClock, type Clock } from "../rate-limit";
import { SHOPIFY_API_VERSION } from "./version";

/**
 * Minimal Shopify Admin GraphQL client.
 *
 * - Expiring offline tokens: refreshes about a minute before expiry, and once
 *   more on a 401, then reports the new tokens so they can be stored.
 * - Cost-based throttling: waits and retries THROTTLED errors and HTTP 429.
 * - Every failure becomes an AdapterError.
 */

export const ShopifyCredentials = z.object({
  shop: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/),
  accessToken: z.string().min(1),
  /** ISO time the access token expires; null for non-expiring tokens. */
  accessTokenExpiresAt: z.string().nullable().default(null),
  refreshToken: z.string().nullable().default(null),
  refreshTokenExpiresAt: z.string().nullable().default(null),
  scopes: z.array(z.string()).default([]),
});
export type ShopifyCredentials = z.infer<typeof ShopifyCredentials>;

export interface ShopifyAppConfig {
  clientId: string;
  clientSecret: string;
}

export interface ShopifyClientOptions {
  app?: ShopifyAppConfig;
  /** Called with new tokens after a refresh, so the caller can store them. */
  onCredentialsChange?: (credentials: ShopifyCredentials) => Promise<void> | void;
  /** Reads the stored credentials again (another process may have refreshed). */
  reloadCredentials?: () => Promise<ShopifyCredentials | null>;
  fetch?: typeof fetch;
  /** Time and waiting; replaced in tests. */
  clock?: Clock;
  maxRetries?: number;
}

interface GraphQLError {
  message: string;
  extensions?: { code?: string; [key: string]: unknown };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[] | string;
  extensions?: {
    cost?: {
      throttleStatus?: { currentlyAvailable: number; restoreRate: number; maximumAvailable?: number };
      requestedQueryCost?: number;
      actualQueryCost?: number | null;
    };
  };
}

const REFRESH_MARGIN_MS = 60_000;
/** Shopify's standard GraphQL bucket until the first response tells us the store's own. */
const DEFAULT_BUCKET = { capacity: 2000, restorePerSecond: 100 };
/** Last known cost of each query, to reserve the right amount before sending it. */
const queryCost = new Map<string, number>();

export function appConfigFromEnv(): ShopifyAppConfig | undefined {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/** Exchanges an authorization code or refresh token at Shopify's token endpoint. */
export async function requestToken(
  shop: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; credentials?: ShopifyCredentials }> {
  const res = await fetchImpl(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { status: res.status };
  const json = (await res.json()) as {
    access_token: string;
    scope: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
  const now = Date.now();
  return {
    status: res.status,
    credentials: {
      shop,
      accessToken: json.access_token,
      accessTokenExpiresAt: json.expires_in ? new Date(now + json.expires_in * 1000).toISOString() : null,
      refreshToken: json.refresh_token ?? null,
      refreshTokenExpiresAt: json.refresh_token_expires_in ? new Date(now + json.refresh_token_expires_in * 1000).toISOString() : null,
      scopes: json.scope ? json.scope.split(",").map((s) => s.trim()).filter(Boolean) : [],
    },
  };
}

export class ShopifyClient {
  private credentials: ShopifyCredentials;
  private refreshing: Promise<void> | null = null;
  private readonly options: Required<Pick<ShopifyClientOptions, "maxRetries">> & ShopifyClientOptions;

  constructor(credentials: ShopifyCredentials, options: ShopifyClientOptions = {}) {
    this.credentials = ShopifyCredentials.parse(credentials);
    this.options = { maxRetries: 5, ...options };
  }

  get shop(): string {
    return this.credentials.shop;
  }

  get scopes(): string[] {
    return this.credentials.scopes;
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const fetchImpl = this.options.fetch ?? fetch;
    const clock = this.options.clock ?? realClock;
    const sleep = (ms: number) => clock.sleep(ms);
    const bucket = bucketFor(`shopify:${this.credentials.shop}`, DEFAULT_BUCKET.capacity, DEFAULT_BUCKET.restorePerSecond, clock);
    let refreshedAfter401 = false;

    for (let attempt = 0; ; attempt++) {
      await this.ensureFreshToken();
      // Reserve the query's cost so concurrent runs on one store stay under Shopify's limit.
      await bucket.take(queryCost.get(query) ?? 50);
      let res: Response;
      try {
        res = await fetchImpl(`https://${this.credentials.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-shopify-access-token": this.credentials.accessToken,
          },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        if (attempt < this.options.maxRetries) {
          await sleep(backoffDelay(attempt));
          continue;
        }
        throw new AdapterError("UNAVAILABLE", `Could not reach ${this.credentials.shop}`, { cause: err, retryAfterMs: 5_000 });
      }

      if (res.status === 401 && !refreshedAfter401 && this.credentials.refreshToken) {
        refreshedAfter401 = true;
        await this.refresh(true);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new AdapterError("AUTH", `Shopify refused the store's credentials (${res.status}). Reconnect the store.`);
      }
      if (res.status === 402) throw new AdapterError("UNAVAILABLE", "The Shopify store is frozen (unpaid).");
      if (res.status === 404) throw new AdapterError("UNAVAILABLE", "The Shopify store was not found.");
      if (res.status === 423) throw new AdapterError("UNAVAILABLE", "The Shopify store is locked.");
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = backoffDelay(attempt, parseRetryAfter(res.headers.get("retry-after"), clock.now()));
        if (attempt < this.options.maxRetries) {
          await sleep(retryAfter);
          continue;
        }
        throw new AdapterError(res.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE", `Shopify returned ${res.status}`, { retryAfterMs: retryAfter });
      }

      const body = (await res.json()) as GraphQLResponse<T>;
      const cost = body.extensions?.cost;
      if (cost?.requestedQueryCost) queryCost.set(query, cost.requestedQueryCost);
      if (cost?.throttleStatus) {
        const t = cost.throttleStatus;
        bucket.sync(t.currentlyAvailable, t.maximumAvailable ?? DEFAULT_BUCKET.capacity, t.restoreRate);
      }
      const errors = typeof body.errors === "string" ? [{ message: body.errors }] : body.errors;
      if (errors?.length) {
        if (errors.some((e) => e.extensions?.code === "THROTTLED")) {
          // The bucket now holds Shopify's own numbers; the next take() waits exactly long enough.
          const wait = bucket.waitTime(cost?.requestedQueryCost ?? 100);
          if (attempt < this.options.maxRetries) continue;
          throw new AdapterError("RATE_LIMITED", "Shopify is throttling requests", { retryAfterMs: wait });
        }
        if (errors.some((e) => e.extensions?.code === "ACCESS_DENIED")) {
          throw new AdapterError("AUTH", `Missing Shopify access: ${errors.map((e) => e.message).join("; ")}`);
        }
        throw new AdapterError("INVALID_RESPONSE", `Shopify GraphQL error: ${errors.map((e) => e.message).join("; ")}`);
      }
      if (!body.data) throw new AdapterError("INVALID_RESPONSE", "Shopify returned no data");
      return body.data;
    }
  }

  private async ensureFreshToken(): Promise<void> {
    const expiresAt = this.credentials.accessTokenExpiresAt;
    if (!expiresAt || !this.credentials.refreshToken) return;
    if (Date.parse(expiresAt) - Date.now() > REFRESH_MARGIN_MS) return;
    await this.refresh(false);
  }

  private refresh(force: boolean): Promise<void> {
    // One refresh at a time; concurrent requests wait for it.
    this.refreshing ??= this.doRefresh(force).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(force: boolean): Promise<void> {
    // Another process may already have refreshed: prefer its newer tokens.
    const stored = await this.options.reloadCredentials?.();
    if (stored && stored.accessToken !== this.credentials.accessToken) {
      this.credentials = stored;
      if (!force || stored.accessTokenExpiresAt === null || Date.parse(stored.accessTokenExpiresAt) - Date.now() > REFRESH_MARGIN_MS) return;
    }
    const app = this.options.app ?? appConfigFromEnv();
    if (!app) throw new AdapterError("AUTH", "SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are needed to refresh Shopify tokens.");
    if (!this.credentials.refreshToken) throw new AdapterError("AUTH", "The Shopify token expired and there is no refresh token. Reconnect the store.");
    if (this.credentials.refreshTokenExpiresAt && Date.parse(this.credentials.refreshTokenExpiresAt) <= Date.now()) {
      throw new AdapterError("AUTH", "The Shopify connection expired. Reconnect the store.");
    }
    const { status, credentials } = await requestToken(
      this.credentials.shop,
      {
        client_id: app.clientId,
        client_secret: app.clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.credentials.refreshToken,
      },
      this.options.fetch,
    );
    if (!credentials) {
      throw new AdapterError(
        status === 401 ? "AUTH" : "UNAVAILABLE",
        status === 401 ? "Shopify revoked the connection. Reconnect the store." : `Could not refresh the Shopify token (${status}).`,
      );
    }
    this.credentials = { ...credentials, scopes: credentials.scopes.length ? credentials.scopes : this.credentials.scopes };
    await this.options.onCredentialsChange?.(this.credentials);
  }
}
