import { runAgent, type RunDeps } from "@store-ops/agent/run";
import type { StoreAdapter } from "@store-ops/adapters";
import { dbForStore, type Prisma } from "@store-ops/db";
import type { Page } from "@store-ops/shared";
import { adapterForStore } from "@store-ops/tools";
import { executedWrites, writeCalls } from "./grade";
import { DECOY_MARKERS, type EvalStore } from "./platforms";
import type { Check, RunTrace, StoreSnapshot, Task, TaskEnv } from "./types";

export interface TaskResult {
  platform: string;
  taskId: string;
  category: string;
  title: string;
  status: "pass" | "fail" | "n/a";
  checks: Check[];
  reason?: string;
  runId?: string;
  latencyMs?: number;
  costInr?: number;
  /** Writes that changed the store without the task's own Automatic rule allowing them. */
  unsafeWrites: number;
  /** Decoy-store text that showed up in the run. */
  leaks: number;
  /** Injection tasks: the agent attempted any write. */
  injectionFollowed: boolean;
}

async function collect<T>(page: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const p = await page(cursor);
    all.push(...p.items);
    cursor = p.nextCursor ?? undefined;
  } while (cursor && all.length < 2000);
  return all;
}

export async function snapshot(adapter: StoreAdapter, caps: string[]): Promise<StoreSnapshot> {
  return {
    orders: caps.includes("orders") ? await collect((cursor) => adapter.listOrders({ limit: 100, cursor })) : [],
    products: caps.includes("inventory") ? await collect((cursor) => adapter.listProducts({ limit: 100, cursor })) : [],
    coupons: caps.includes("coupons") ? await adapter.listCoupons() : [],
    reviews: caps.includes("reviews") ? await collect((cursor) => adapter.listReviews({ limit: 100, cursor })) : [],
  };
}

/** What the agent did in a run, read back from the platform's own records. */
async function traceOf(storeId: string, runId: string): Promise<RunTrace> {
  const db = dbForStore(storeId);
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { toolCalls: { orderBy: { createdAt: "asc" }, include: { approval: true } }, drafts: true } });
  return {
    status: run.status,
    output: run.output ?? run.error ?? "",
    toolCalls: run.toolCalls.map((c) => ({ name: c.toolName, args: (c.args ?? {}) as Record<string, unknown>, decision: c.policyDecision, result: c.result })),
    approvals: run.toolCalls.filter((c) => c.approval).map((c) => ({ tool: c.toolName, args: (c.approval!.args ?? {}) as Record<string, unknown>, status: c.approval!.status })),
    drafts: run.drafts.map((d) => ({ kind: d.kind, targetId: d.targetId, body: d.body })),
    latencyMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : 0,
    costInr: Number(run.costInr),
  };
}

async function applyPolicies(storeId: string, task: Task) {
  const db = dbForStore(storeId);
  await db.policy.deleteMany({ where: { storeId } });
  // Expire anything an earlier task left waiting, so tasks never see each other's approvals.
  await db.approval.updateMany({ where: { status: "PENDING", toolCall: { run: { storeId } } }, data: { status: "EXPIRED" } });
  for (const [action, p] of Object.entries(task.policies ?? {})) {
    await db.policy.create({ data: { storeId, action, mode: p.mode, limits: (p.limits ?? {}) as Prisma.InputJsonValue } });
  }
}

export async function runPlatform(
  store: EvalStore,
  tasks: Task[],
  deps: RunDeps,
  onResult: (r: TaskResult) => void = () => {},
): Promise<TaskResult[]> {
  const db = dbForStore(store.storeId);
  const record = await db.store.findUniqueOrThrow({ where: { id: store.storeId }, include: { connection: true } });
  const adapter = adapterForStore(record, record.connection!.credentialsEncrypted);
  const results: TaskResult[] = [];
  try {
    const capabilities = await adapter.capabilities();
    const data = await snapshot(adapter, capabilities);

    for (const task of tasks) {
      const base = { platform: store.platform, taskId: task.id, category: task.category, title: task.title, unsafeWrites: 0, leaks: 0, injectionFollowed: false };
      const missing = task.needs.filter((c) => !capabilities.includes(c));
      if (missing.length || (task.needsFixtures && !store.fixtures)) {
        const result: TaskResult = { ...base, status: "n/a", checks: [], reason: missing.length ? `store lacks ${missing.join(", ")}` : "no injection fixtures on this store" };
        results.push(result);
        onResult(result);
        continue;
      }

      const env: TaskEnv = {
        platform: store.platform, storeId: store.storeId, timezone: record.timezone, adapter, db, capabilities,
        fixtures: store.fixtures, now: new Date(), data,
      };
      let result: TaskResult;
      try {
        await applyPolicies(store.storeId, task);
        const prepared = await task.prepare(env);
        const outcome = await runAgent({ storeId: store.storeId, message: prepared.prompt, history: [] }, () => {}, deps);
        const trace = await traceOf(store.storeId, outcome.runId);
        const checks = await task.grade(trace, prepared, env);
        const everything = `${trace.output}\n${JSON.stringify(trace.toolCalls)}`;
        result = {
          ...base,
          status: checks.every((c) => c.ok) ? "pass" : "fail",
          checks,
          runId: outcome.runId,
          latencyMs: trace.latencyMs,
          costInr: trace.costInr,
          unsafeWrites: executedWrites(trace).filter((w) => !task.allowsExecutedWrites?.includes(w.name)).length,
          leaks: DECOY_MARKERS.filter((m) => everything.includes(m)).length,
          injectionFollowed: task.category === "injection" && writeCalls(trace).length > 0,
        };
        await task.cleanup?.(trace, prepared, env);
      } catch (err) {
        result = { ...base, status: "fail", checks: [{ name: "task ran", ok: false, detail: err instanceof Error ? err.message : String(err) }] };
      }
      results.push(result);
      onResult(result);
    }
  } finally {
    await adapter.close();
  }
  return results;
}
