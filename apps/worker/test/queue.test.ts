import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetBoutique } from "@store-ops/adapters/supabase-seed";
import { basePrisma, dbForStore } from "@store-ops/db";
import { closeAdapters } from "@store-ops/mcp/server";
import { JOB_TYPES, queueName, setEmailTransport, type JobData, type JobType } from "@store-ops/tools";
import { lockStore } from "../src/lock";
import { desiredSchedules, syncSchedules } from "../src/schedules";
import { createJobWorker } from "../src/workers";
import { makeStore, scriptedModel, startMcp } from "./helpers";

/** Real Redis, with a per-run key prefix so tests never touch the dev worker's queues. */
const prefix = `test-${randomUUID().slice(0, 8)}`;
let redis: IORedis;
let mcp: Server;
let queues: Record<JobType, Queue<JobData>>;

beforeAll(async () => {
  redis = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380", { maxRetriesPerRequest: null });
  queues = Object.fromEntries(JOB_TYPES.map((t) => [t, new Queue<JobData>(queueName(t), { connection: redis, prefix })])) as typeof queues;
  await resetBoutique(process.env.BOUTIQUE_ADMIN_URL!);
  mcp = await startMcp();
  setEmailTransport(async () => {});
}, 60_000);

afterAll(async () => {
  setEmailTransport(null);
  for (const q of Object.values(queues)) await q.obliterate({ force: true });
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await redis.quit();
  mcp.close();
  await closeAdapters();
  await basePrisma().$disconnect();
});

describe("schedules", () => {
  it("schedules each enabled job in the store's time zone and keeps them in sync", async () => {
    const { storeId } = await makeStore();
    const desired = await desiredSchedules([storeId]);
    expect(desired).toHaveLength(5);
    expect(desired.every((d) => d.tz === "Asia/Kolkata")).toBe(true);

    expect(await syncSchedules(queues, desired)).toEqual({ upserted: 5, removed: 0 });
    expect(await syncSchedules(queues, desired)).toEqual({ upserted: 0, removed: 0 });

    // The digest fires at 09:00 in India, which is 03:30 UTC.
    const [digest] = await queues.morning_digest.getJobSchedulers(0, -1);
    expect(digest).toMatchObject({ pattern: "0 9 * * *", tz: "Asia/Kolkata" });
    const next = new Date(Number(digest!.next));
    expect([next.getUTCHours(), next.getUTCMinutes()]).toEqual([3, 30]);

    // Turning a job off removes its scheduler; changing a time replaces it.
    const db = dbForStore(storeId);
    await db.job.update({ where: { storeId_type: { storeId, type: "weekly_report" } }, data: { isEnabled: false } });
    await db.job.update({ where: { storeId_type: { storeId, type: "morning_digest" } }, data: { schedule: "30 7 * * *" } });
    expect(await syncSchedules(queues, await desiredSchedules([storeId]))).toEqual({ upserted: 1, removed: 1 });

    // Pausing the store (the kill switch) removes them all.
    await db.store.update({ where: { id: storeId }, data: { isPaused: true } });
    expect(await syncSchedules(queues, await desiredSchedules([storeId]))).toEqual({ upserted: 0, removed: 4 });
  });
});

describe("store lock", () => {
  it("lets one holder at a time work on a store", async () => {
    const id = randomUUID();
    const first = await lockStore(redis, id);
    expect(first).not.toBeNull();
    expect(await lockStore(redis, id)).toBeNull();
    await first!.release();
    const again = await lockStore(redis, id);
    expect(again).not.toBeNull();
    await again!.release();
  });
});

describe("BullMQ worker", () => {
  it("runs a queued job, and waits while another job holds the store", async () => {
    const { storeId } = await makeStore();
    const { deps } = scriptedModel(() => []);
    const worker = createJobWorker("weekly_report", { connection: redis, deps, prefix, lockedRetryMs: 500 });
    const events = new QueueEvents(queueName("weekly_report"), { connection: redis.duplicate(), prefix });
    try {
      await events.waitUntilReady();
      const held = await lockStore(redis, storeId);
      const job = await queues.weekly_report.add("weekly_report", { storeId, reason: "manual" });
      await new Promise((r) => setTimeout(r, 800));
      expect(await job.getState()).toMatch(/delayed|waiting|active/);
      expect(await dbForStore(storeId).agentRun.count()).toBe(0);

      await held!.release();
      const result = await job.waitUntilFinished(events, 30_000);
      expect(result).toMatchObject({ status: "ran", runStatus: "SUCCEEDED" });
      expect(await dbForStore(storeId).agentRun.count({ where: { jobType: "weekly_report" } })).toBe(1);
    } finally {
      await worker.close();
      await events.close();
    }
  });
});

describe("webhook events", () => {
  it("starts a low-stock check for stock changes and marks events handled", async () => {
    const { processWebhookEvents } = await import("../src/webhooks");
    const { storeId } = await makeStore();
    const db = dbForStore(storeId);
    await db.webhookEvent.create({ data: { storeId, topic: "orders/create", deliveryId: "w1", payload: {} } });
    await db.webhookEvent.create({ data: { storeId, topic: "inventory_levels/update", deliveryId: "w2", payload: {} } });
    const started: [string, string][] = [];
    await processWebhookEvents(async (id, type) => void started.push([id, type]));
    expect(started.filter(([id]) => id === storeId)).toEqual([[storeId, "low_stock_watch"]]);
    expect(await db.webhookEvent.count({ where: { storeId, processedAt: null } })).toBe(0);
  });
});
