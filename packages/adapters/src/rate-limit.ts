/**
 * Client-side rate limiting, so the agent stays under each platform's limits
 * instead of hitting them and backing off.
 *
 * - A token bucket per store (keyed by its API host), shared by every adapter
 *   instance in the process for that store.
 * - Shopify's GraphQL limit is cost-based: its bucket is re-synced from the
 *   throttle status Shopify returns with each response.
 * - When a platform still says "slow down", retries wait for Retry-After or
 *   an exponential backoff with full jitter.
 */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private capacity: number,
    private refillPerSecond: number,
    private readonly clock: Clock = realClock,
  ) {
    this.tokens = capacity;
    this.updatedAt = clock.now();
  }

  private refill() {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updatedAt) / 1000) * this.refillPerSecond);
    this.updatedAt = now;
  }

  /** How long a request of `cost` would wait right now, in milliseconds. */
  waitTime(cost = 1): number {
    this.refill();
    const needed = Math.min(cost, this.capacity) - this.tokens;
    return needed <= 0 ? 0 : Math.ceil((needed / this.refillPerSecond) * 1000);
  }

  /** Waits until `cost` tokens are available, then takes them. */
  async take(cost = 1): Promise<number> {
    let waited = 0;
    for (;;) {
      const wait = this.waitTime(cost);
      if (wait === 0) break;
      await this.clock.sleep(wait);
      waited += wait;
    }
    this.tokens -= Math.min(cost, this.capacity);
    return waited;
  }

  /** Adopts the platform's own view of the bucket (Shopify's throttleStatus). */
  sync(available: number, capacity: number, refillPerSecond: number) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = Math.min(available, capacity);
    this.updatedAt = this.clock.now();
  }
}

const buckets = new Map<string, TokenBucket>();

/** The shared bucket for a key, created with these limits on first use. */
export function bucketFor(key: string, capacity: number, refillPerSecond: number, clock: Clock = realClock): TokenBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = new TokenBucket(capacity, refillPerSecond, clock);
    buckets.set(key, bucket);
  }
  return bucket;
}

export function resetBuckets(): void {
  buckets.clear();
}

/**
 * How long to wait before retry `attempt` (0-based): the platform's
 * Retry-After when given, else exponential backoff with full jitter, capped.
 */
export function backoffDelay(attempt: number, retryAfterMs?: number | null, opts: { baseMs?: number; maxMs?: number; random?: () => number } = {}): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, opts.maxMs ?? 60_000);
  const ceiling = Math.min((opts.baseMs ?? 500) * 2 ** attempt, opts.maxMs ?? 8_000);
  return Math.round((opts.random ?? Math.random)() * ceiling) + 50;
}

/** Retry-After as milliseconds: seconds, or an HTTP date. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/** Requests per second for a platform, from the environment or a default. */
export function platformRate(envVar: string, fallback: number): number {
  const value = Number(process.env[envVar]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
