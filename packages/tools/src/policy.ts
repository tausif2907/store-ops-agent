import { z } from "zod";
import { ORDER_STATUSES } from "@store-ops/shared";
import type { PolicyMode, ToolDefinition } from "./catalog";

/**
 * The policy engine. The model chooses actions; this code decides whether
 * they run. Pure and synchronous: callers gather the facts it needs.
 *
 * - AUTO runs immediately, within the owner's limits. Breaking a limit falls
 *   back to ASK, with the reason shown to the owner.
 * - ASK saves a pending approval with the exact arguments.
 * - NEVER hides the tool from the agent.
 * - A paused store (the kill switch) refuses every write.
 * Reads and drafts are AUTO or NEVER; they never need approval.
 */

const maxPerDay = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .optional()
  .describe("Most automatic runs per day, in the store's time zone");

/** Limits an owner can put on an Auto write, per tool. */
export const WRITE_LIMITS = {
  create_coupon: z
    .object({
      maxPercent: z.number().int().min(1).max(100).optional(),
      maxFixedAmount: z.number().int().min(1).optional().describe("Minor units, e.g. paise"),
      maxUsageLimit: z.number().int().min(1).optional(),
      maxPerDay,
    })
    .strict(),
  update_stock: z
    .object({
      maxChange: z.number().int().min(1).max(100_000).optional().describe("Largest change in units, up or down"),
      maxPerDay,
    })
    .strict(),
  update_order_status: z
    .object({
      allowedStatuses: z.array(z.enum(ORDER_STATUSES)).min(1).optional(),
      maxPerDay,
    })
    .strict(),
  reply_to_review: z.object({ maxPerDay }).strict(),
} as const;

export type LimitedTool = keyof typeof WRITE_LIMITS;
export type ToolLimits<T extends LimitedTool = LimitedTool> = z.infer<(typeof WRITE_LIMITS)[T]>;

export function isLimitedTool(name: string): name is LimitedTool {
  return name in WRITE_LIMITS;
}

export interface StorePolicy {
  mode: PolicyMode;
  limits: unknown;
}

/** Facts about the store that some limits depend on. */
export interface PolicyFacts {
  /** Automatic runs of this tool so far today (store time zone). */
  autoRunsToday?: number;
  /** Current stock of the variant being changed; null when untracked. */
  currentStock?: number | null;
}

export type Decision =
  | { outcome: "RUN"; mode: "AUTO" }
  | { outcome: "APPROVAL"; mode: "ASK" | "AUTO"; reason: string | null }
  | { outcome: "DENY"; mode: "NEVER" | "PAUSED"; reason: string };

/** The modes an owner may pick for a tool. */
export function allowedModes(tool: Pick<ToolDefinition, "type">): PolicyMode[] {
  return tool.type === "write" ? ["AUTO", "ASK", "NEVER"] : ["AUTO", "NEVER"];
}

export function effectiveMode(tool: Pick<ToolDefinition, "type" | "defaultMode">, policy: StorePolicy | undefined): PolicyMode {
  const mode = policy?.mode ?? tool.defaultMode;
  // Reads and drafts cannot be put behind approval, only turned off.
  if (tool.type !== "write" && mode === "ASK") return "AUTO";
  return mode;
}

/** Which facts `decide` needs for this call, so callers fetch only those. */
export function factsNeeded(tool: Pick<ToolDefinition, "name" | "type" | "defaultMode">, policy: StorePolicy | undefined) {
  const none = { autoRunsToday: false, currentStock: false };
  if (effectiveMode(tool, policy) !== "AUTO" || tool.type !== "write" || !isLimitedTool(tool.name)) return none;
  const parsed = WRITE_LIMITS[tool.name].safeParse(policy?.limits ?? {});
  if (!parsed.success) return none;
  const limits = parsed.data as { maxPerDay?: number; maxChange?: number };
  return { autoRunsToday: limits.maxPerDay !== undefined, currentStock: tool.name === "update_stock" && limits.maxChange !== undefined };
}

/** Why an Auto call breaks the owner's limits; empty when it is within them. */
export function limitViolations(toolName: string, rawLimits: unknown, input: Record<string, unknown>, facts: PolicyFacts): string[] {
  if (!isLimitedTool(toolName)) return [];
  const parsed = WRITE_LIMITS[toolName].safeParse(rawLimits ?? {});
  // Limits we cannot read must not quietly allow everything.
  if (!parsed.success) return ["the saved limits for this action are invalid"];
  const limits = parsed.data as ToolLimits;
  const problems: string[] = [];

  if (limits.maxPerDay !== undefined) {
    if (facts.autoRunsToday === undefined) problems.push("today's count of automatic runs is unknown");
    else if (facts.autoRunsToday >= limits.maxPerDay) problems.push(`already ran ${facts.autoRunsToday} times today (limit ${limits.maxPerDay})`);
  }

  switch (toolName) {
    case "create_coupon": {
      const l = limits as ToolLimits<"create_coupon">;
      const type = input.type as "percent" | "fixed";
      const value = input.value as number;
      const usageLimit = (input.usageLimit as number | null | undefined) ?? null;
      const capsSet = l.maxPercent !== undefined || l.maxFixedAmount !== undefined;
      if (type === "percent" && capsSet) {
        if (l.maxPercent === undefined) problems.push("percent coupons are not covered by the Auto limits");
        else if (value > l.maxPercent) problems.push(`${value}% off is over the ${l.maxPercent}% limit`);
      }
      if (type === "fixed" && capsSet) {
        if (l.maxFixedAmount === undefined) problems.push("fixed-amount coupons are not covered by the Auto limits");
        else if (value > l.maxFixedAmount) problems.push(`${value} off is over the ${l.maxFixedAmount} limit (minor units)`);
      }
      if (l.maxUsageLimit !== undefined) {
        if (usageLimit === null) problems.push(`the coupon has no usage limit (Auto allows up to ${l.maxUsageLimit} uses)`);
        else if (usageLimit > l.maxUsageLimit) problems.push(`${usageLimit} uses is over the ${l.maxUsageLimit}-use limit`);
      }
      break;
    }
    case "update_stock": {
      const l = limits as ToolLimits<"update_stock">;
      if (l.maxChange !== undefined) {
        if (facts.currentStock === undefined || facts.currentStock === null) {
          problems.push("the variant's current stock is unknown");
        } else {
          const change = Math.abs((input.quantity as number) - facts.currentStock);
          if (change > l.maxChange) problems.push(`a change of ${change} units is over the ±${l.maxChange} limit`);
        }
      }
      break;
    }
    case "update_order_status": {
      const l = limits as ToolLimits<"update_order_status">;
      if (l.allowedStatuses && !l.allowedStatuses.includes(input.status as (typeof ORDER_STATUSES)[number])) {
        problems.push(`changing to "${String(input.status)}" is not allowed automatically`);
      }
      break;
    }
    case "reply_to_review":
      break;
  }
  return problems;
}

export function decide(args: {
  tool: Pick<ToolDefinition, "name" | "type" | "defaultMode">;
  policy: StorePolicy | undefined;
  storePaused: boolean;
  input: Record<string, unknown>;
  facts?: PolicyFacts;
}): Decision {
  const { tool, policy, storePaused, input, facts = {} } = args;
  const mode = effectiveMode(tool, policy);
  if (mode === "NEVER") return { outcome: "DENY", mode, reason: `The owner has turned off ${tool.name} for this store.` };
  if (tool.type !== "write") return { outcome: "RUN", mode: "AUTO" };
  if (storePaused) return { outcome: "DENY", mode: "PAUSED", reason: "The store is paused, so no changes can be made." };
  if (mode === "ASK") return { outcome: "APPROVAL", mode, reason: null };

  const problems = limitViolations(tool.name, policy?.limits, input, facts);
  if (problems.length > 0) return { outcome: "APPROVAL", mode: "AUTO", reason: `Over the Auto limits: ${problems.join("; ")}.` };
  return { outcome: "RUN", mode: "AUTO" };
}

// ---- Settings ---------------------------------------------------------------

/** One row of the owner's policy settings, validated against the tool. */
export function parsePolicySetting(
  tool: Pick<ToolDefinition, "name" | "type">,
  setting: { mode: string; limits?: unknown },
): { ok: true; value: StorePolicy & { limits: Record<string, unknown> } } | { ok: false; error: string } {
  const mode = setting.mode as PolicyMode;
  if (!allowedModes(tool).includes(mode)) return { ok: false, error: `${tool.name}: mode ${setting.mode} is not allowed` };
  if (!isLimitedTool(tool.name)) return { ok: true, value: { mode, limits: {} } };
  const parsed = WRITE_LIMITS[tool.name].safeParse(setting.limits ?? {});
  if (!parsed.success) {
    return { ok: false, error: `${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  }
  return { ok: true, value: { mode, limits: parsed.data as Record<string, unknown> } };
}
