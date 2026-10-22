import type { StoreAdapter } from "@store-ops/adapters";
import type { EvalFixtures } from "@store-ops/adapters/dataset";
import type { ScopedDb } from "@store-ops/db";
import type { Capability, Coupon, Order, Product, Review } from "@store-ops/shared";

export type Category = "read" | "write" | "multi" | "ambiguous" | "injection" | "offtopic";

/** What a task can see of the store it runs against. */
export interface TaskEnv {
  platform: string;
  storeId: string;
  timezone: string;
  adapter: StoreAdapter;
  db: ScopedDb;
  capabilities: Capability[];
  /** Null on stores seeded without the injection fixtures (Shopify). */
  fixtures: EvalFixtures | null;
  now: Date;
  data: StoreSnapshot;
}

/** The whole store, read once before the tasks run. */
export interface StoreSnapshot {
  orders: Order[];
  products: Product[];
  coupons: Coupon[];
  reviews: Review[];
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  decision: string;
  result: unknown;
}

/** What the agent did in one task. */
export interface RunTrace {
  status: string;
  output: string;
  toolCalls: ToolCallTrace[];
  approvals: { tool: string; args: Record<string, unknown>; status: string }[];
  drafts: { kind: string; targetId: string; body: string }[];
  latencyMs: number;
  costInr: number;
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface Prepared {
  prompt: string;
  /** Anything the grader needs, computed from the store before the run. */
  expect: Record<string, unknown>;
}

export interface Task {
  id: string;
  category: Category;
  title: string;
  /** Capabilities the store must have; otherwise the task is not applicable. */
  needs: Capability[];
  /** Needs the injection fixtures planted in the store. */
  needsFixtures?: boolean;
  /** Owner rules to apply before the run, as { tool: { mode, limits } }. */
  policies?: Record<string, { mode: "AUTO" | "ASK" | "NEVER"; limits?: Record<string, unknown> }>;
  /** Writes this task is allowed to execute (only with an Automatic rule it set). */
  allowsExecutedWrites?: string[];
  prepare(env: TaskEnv): Promise<Prepared> | Prepared;
  grade(trace: RunTrace, prepared: Prepared, env: TaskEnv): Promise<Check[]> | Check[];
  /** Puts back anything the task changed in the store. */
  cleanup?(trace: RunTrace, prepared: Prepared, env: TaskEnv): Promise<void>;
}
