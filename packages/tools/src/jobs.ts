import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import type { ScopedDb } from "@store-ops/db";
import type { Capability } from "@store-ops/shared";

/**
 * The autonomous jobs: runs that start from a schedule or a store event, not
 * from chat. Schedules are cron patterns evaluated in each store's own time
 * zone. Shared by the worker (which runs them) and the dashboard (which
 * edits them and can start one now).
 */

export const JOB_TYPES = ["morning_digest", "low_stock_watch", "late_order_followup", "negative_review_response", "weekly_report"] as const;
export const JobType = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof JobType>;

export const LowStockConfig = z.object({ threshold: z.number().int().min(0).max(1000).default(3) });

export interface JobDefinition {
  type: JobType;
  title: string;
  description: string;
  defaultSchedule: string;
  /** The store must support this for the job to run. */
  capability: Capability;
  /** Run limits for the agent loop. */
  maxToolCalls: number;
  config: z.ZodObject;
}

export const JOBS: Record<JobType, JobDefinition> = {
  morning_digest: {
    type: "morning_digest",
    title: "Morning digest",
    description: "Yesterday's sales, orders due today, late orders, low stock and new reviews, by email and on the dashboard.",
    defaultSchedule: "0 9 * * *",
    capability: "orders",
    maxToolCalls: 8,
    config: z.object({}),
  },
  low_stock_watch: {
    type: "low_stock_watch",
    title: "Low-stock watch",
    description: "Alerts you when products fall to your threshold, with a restock suggestion. Quiet when nothing has changed.",
    defaultSchedule: "0 * * * *",
    capability: "inventory",
    maxToolCalls: 6,
    config: LowStockConfig,
  },
  late_order_followup: {
    type: "late_order_followup",
    title: "Late-order follow-up",
    description: "Finds orders past their promised date and drafts an apology to each customer for you to send.",
    defaultSchedule: "0 10 * * *",
    capability: "orders",
    maxToolCalls: 12,
    config: z.object({}),
  },
  negative_review_response: {
    type: "negative_review_response",
    title: "Negative review response",
    description: "Reads new 1–2 star reviews and the orders behind them, and drafts a reply (posted directly if you set review replies to Automatic).",
    defaultSchedule: "*/30 * * * *",
    capability: "reviews",
    maxToolCalls: 12,
    config: z.object({}),
  },
  weekly_report: {
    type: "weekly_report",
    title: "Weekly report",
    description: "Week-over-week sales, best and worst products, and coupon results, every Monday.",
    defaultSchedule: "0 9 * * 1",
    capability: "orders",
    maxToolCalls: 8,
    config: z.object({}),
  },
};

/** The schedules the dashboard offers: daily or weekly at a time, or every N minutes/hours. */
const CRON = /^(?:(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])|\*\/(5|10|15|20|30) \* \* \* \*|0 (\*|\*\/(?:2|3|4|6|8|12)) \* \* \*)$/;

export function isValidSchedule(cron: string): boolean {
  const m = CRON.exec(cron.trim());
  if (!m) return false;
  if (m[1] !== undefined) return Number(m[1]) < 60 && Number(m[2]) < 24;
  return true;
}

/** "0 9 * * *" → "Every day at 09:00"; used in the dashboard and emails. */
export function describeSchedule(cron: string): string {
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(cron);
  if (daily) {
    const time = `${daily[2]!.padStart(2, "0")}:${daily[1]!.padStart(2, "0")}`;
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return daily[3] === "*" ? `Every day at ${time}` : `Every ${days[Number(daily[3])]} at ${time}`;
  }
  const minutes = /^\*\/(\d+) \* \* \* \*$/.exec(cron);
  if (minutes) return `Every ${minutes[1]} minutes`;
  if (cron === "0 * * * *") return "Every hour";
  const hours = /^0 \*\/(\d+) \* \* \*$/.exec(cron);
  if (hours) return `Every ${hours[1]} hours`;
  return cron;
}

/** Creates any job rows a store is missing, with default schedules, enabled. */
export async function ensureDefaultJobs(db: ScopedDb, storeId: string): Promise<void> {
  const existing = new Set((await db.job.findMany({ where: { storeId }, select: { type: true } })).map((j) => j.type));
  for (const def of Object.values(JOBS)) {
    if (existing.has(def.type)) continue;
    await db.job.create({
      data: { storeId, type: def.type, schedule: def.defaultSchedule, config: def.config.parse({}) as object },
    });
  }
}

// ---- Queues -------------------------------------------------------------------

export interface JobData {
  storeId: string;
  /** Why it ran: "schedule", "manual" (Run now), or "webhook". */
  reason: "schedule" | "manual" | "webhook";
}

export const queueName = (type: JobType) => `store-jobs-${type}`;

let connection: IORedis | undefined;
const queues = new Map<JobType, Queue<JobData>>();

/** Shared Redis connection (REDIS_URL). BullMQ needs maxRetriesPerRequest: null. */
export function redisConnection(): IORedis {
  connection ??= new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6380", { maxRetriesPerRequest: null });
  return connection;
}

export function jobQueue(type: JobType): Queue<JobData> {
  let queue = queues.get(type);
  if (!queue) {
    queue = new Queue<JobData>(queueName(type), {
      connection: redisConnection(),
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: 500, removeOnFail: 1000 },
    });
    queues.set(type, queue);
  }
  return queue;
}

/** Starts a job for a store now (the dashboard's "Run now"). At most one per store and job a minute. Returns the queue job id. */
export async function enqueueJobNow(storeId: string, type: JobType, reason: JobData["reason"] = "manual"): Promise<string> {
  const minute = Math.floor(Date.now() / 60_000);
  const jobId = `${reason}-${type}-${storeId}-${minute}`;
  await jobQueue(type).add(type, { storeId, reason }, { jobId });
  return jobId;
}

/**
 * Starts a newly connected store's first morning digest, so the owner sees
 * the agent work on their own data within minutes instead of at 09:00
 * tomorrow. Returns the queue job id, or null when the queue cannot be
 * reached (the welcome page then offers to try again).
 */
export async function startFirstDigest(storeId: string): Promise<string | null> {
  // With Redis down, ioredis queues commands instead of failing: give up after a few seconds.
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), 5_000)));
  try {
    return await Promise.race([enqueueJobNow(storeId, "morning_digest", "manual"), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface QueuedJobState {
  state: "queued" | "active" | "skipped" | "failed" | "done" | "missing";
  /** Why it was skipped, or why it failed. */
  reason?: string;
  queuedAt?: number;
}

/** Where a queued job for this store stands, for pages that wait on it. */
export async function queuedJobState(type: JobType, jobId: string, storeId: string): Promise<QueuedJobState> {
  const job = await jobQueue(type).getJob(jobId);
  if (!job || job.data.storeId !== storeId) return { state: "missing" };
  const state = await job.getState();
  if (state === "failed") return { state: "failed", reason: job.failedReason, queuedAt: job.timestamp };
  if (state === "active") return { state: "active", queuedAt: job.timestamp };
  if (state === "completed") {
    const result = job.returnvalue as { status?: string; reason?: string } | undefined;
    return result?.status === "skipped" ? { state: "skipped", reason: result.reason, queuedAt: job.timestamp } : { state: "done", queuedAt: job.timestamp };
  }
  return { state: "queued", queuedAt: job.timestamp };
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  await connection?.quit();
  connection = undefined;
}
