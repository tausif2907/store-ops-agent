import IORedis from "ioredis";

/**
 * Fixed-window rate limits for sign-in, sign-up, password resets, two-factor
 * codes and chat, counted in Redis so every server instance shares them.
 * When Redis cannot be reached the count falls back to this process's memory
 * rather than turning limits off.
 */

let client: IORedis | null = null;
const memory = new Map<string, { count: number; resetAt: number }>();

function redis(): IORedis {
  // Fail fast: a slow or missing Redis must not hold up a login.
  if (!client) {
    client = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380", {
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
    });
    client.on("error", () => {}); // reported through the failed command instead
  }
  return client;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets. */
  retryAfter: number;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const fullKey = `store-ops:rl:${key}`;
  try {
    const r = redis();
    const [[, count], [, ttl]] = (await Promise.race([
      r.multi().incr(fullKey).ttl(fullKey).exec(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1_000)),
    ])) as [[null, number], [null, number]];
    if (ttl < 0) await r.expire(fullKey, windowSeconds);
    return { ok: count <= limit, retryAfter: ttl > 0 ? ttl : windowSeconds };
  } catch {
    const now = Date.now();
    const entry = memory.get(fullKey);
    if (!entry || entry.resetAt <= now) {
      memory.set(fullKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { ok: 1 <= limit, retryAfter: windowSeconds };
    }
    entry.count++;
    return { ok: entry.count <= limit, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
}

/** Clears a key, e.g. after a successful sign-in. */
export async function resetRateLimit(key: string): Promise<void> {
  memory.delete(`store-ops:rl:${key}`);
  try {
    await redis().del(`store-ops:rl:${key}`);
  } catch {
    // Expires on its own.
  }
}

export function describeRetry(seconds: number): string {
  return seconds >= 120 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}
