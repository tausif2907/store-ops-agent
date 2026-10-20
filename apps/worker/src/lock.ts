import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";

/**
 * One run per store at a time, across every job queue: two jobs never act on
 * the same store at once. A Redis key with an owner token and an expiry, so a
 * crashed worker cannot hold a store forever.
 */

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface StoreLock {
  release(): Promise<void>;
}

export async function lockStore(redis: IORedis, storeId: string, ttlMs = 10 * 60_000): Promise<StoreLock | null> {
  const key = `store-ops:lock:store:${storeId}`;
  const token = randomUUID();
  const ok = await redis.set(key, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;
  return {
    release: async () => {
      await redis.eval(RELEASE, 1, key, token);
    },
  };
}
