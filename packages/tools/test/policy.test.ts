import { describe, expect, it } from "vitest";
import { getTool } from "../src/catalog";
import { allowedModes, decide, effectiveMode, factsNeeded, limitViolations, parsePolicySetting } from "../src/policy";

const tool = (name: string) => getTool(name)!;
const auto = (limits: unknown = {}) => ({ mode: "AUTO" as const, limits });

describe("modes", () => {
  it("uses each tool's default when the owner has not set one", () => {
    expect(decide({ tool: tool("search_orders"), policy: undefined, storePaused: false, input: {} })).toEqual({ outcome: "RUN", mode: "AUTO" });
    expect(decide({ tool: tool("create_coupon"), policy: undefined, storePaused: false, input: {} })).toEqual({
      outcome: "APPROVAL", mode: "ASK", reason: null,
    });
  });

  it("runs Auto writes and saves Ask writes for approval", () => {
    const input = { variantId: "v", quantity: 5 };
    expect(decide({ tool: tool("update_stock"), policy: auto(), storePaused: false, input }).outcome).toBe("RUN");
    expect(decide({ tool: tool("update_stock"), policy: { mode: "ASK", limits: {} }, storePaused: false, input }).outcome).toBe("APPROVAL");
  });

  it("denies Never for reads and writes alike", () => {
    for (const name of ["search_reviews", "draft_review_reply", "reply_to_review"]) {
      expect(decide({ tool: tool(name), policy: { mode: "NEVER", limits: {} }, storePaused: false, input: {} })).toMatchObject({
        outcome: "DENY", mode: "NEVER",
      });
    }
  });

  it("never puts reads or drafts behind approval", () => {
    expect(effectiveMode(tool("search_orders"), { mode: "ASK", limits: {} })).toBe("AUTO");
    expect(allowedModes(tool("draft_customer_message"))).toEqual(["AUTO", "NEVER"]);
    expect(allowedModes(tool("update_order_status"))).toEqual(["AUTO", "ASK", "NEVER"]);
  });
});

describe("kill switch", () => {
  it("refuses every write, whatever the mode", () => {
    for (const policy of [auto(), { mode: "ASK" as const, limits: {} }, undefined]) {
      expect(decide({ tool: tool("create_coupon"), policy, storePaused: true, input: { type: "percent", value: 5 } })).toMatchObject({
        outcome: "DENY", mode: "PAUSED",
      });
    }
  });

  it("still allows reads, so the owner can ask what is going on", () => {
    expect(decide({ tool: tool("sales_summary"), policy: undefined, storePaused: true, input: {} }).outcome).toBe("RUN");
  });
});

describe("coupon limits", () => {
  const limits = { maxPercent: 10, maxUsageLimit: 100 };
  const run = (input: Record<string, unknown>) => decide({ tool: tool("create_coupon"), policy: auto(limits), storePaused: false, input });

  it("runs a coupon within the limits", () => {
    expect(run({ code: "OK10", type: "percent", value: 10, usageLimit: 100 }).outcome).toBe("RUN");
  });

  it("falls back to approval over the percent limit, saying why", () => {
    const d = run({ code: "BIG25", type: "percent", value: 25, usageLimit: 50 });
    expect(d).toMatchObject({ outcome: "APPROVAL", mode: "AUTO" });
    expect(d.outcome === "APPROVAL" && d.reason).toMatch(/25% off is over the 10% limit/);
  });

  it("requires a usage limit within the cap", () => {
    expect(run({ code: "NOCAP", type: "percent", value: 5 }).outcome).toBe("APPROVAL");
    expect(run({ code: "MANY", type: "percent", value: 5, usageLimit: 500 }).outcome).toBe("APPROVAL");
  });

  it("does not let fixed-amount coupons slip past percent-only limits", () => {
    expect(run({ code: "FLAT", type: "fixed", value: 100_000, usageLimit: 10 }).outcome).toBe("APPROVAL");
  });

  it("checks fixed amounts against their own cap", () => {
    const d = (value: number) =>
      decide({ tool: tool("create_coupon"), policy: auto({ maxFixedAmount: 50_000 }), storePaused: false, input: { type: "fixed", value } });
    expect(d(50_000).outcome).toBe("RUN");
    expect(d(50_001).outcome).toBe("APPROVAL");
  });
});

describe("stock limits", () => {
  const policy = auto({ maxChange: 20 });
  const run = (quantity: number, currentStock: number | null | undefined) =>
    decide({ tool: tool("update_stock"), policy, storePaused: false, input: { variantId: "v", quantity }, facts: { currentStock } });

  it("allows changes up to ±20 units", () => {
    expect(run(25, 5).outcome).toBe("RUN");
    expect(run(0, 20).outcome).toBe("RUN");
  });

  it("asks for larger changes", () => {
    expect(run(26, 5).outcome).toBe("APPROVAL");
    expect(run(0, 21).outcome).toBe("APPROVAL");
  });

  it("asks when the current stock is unknown or untracked", () => {
    expect(run(5, undefined).outcome).toBe("APPROVAL");
    expect(run(5, null).outcome).toBe("APPROVAL");
  });

  it("only asks for the current stock when a change limit is set", () => {
    expect(factsNeeded(tool("update_stock"), policy)).toEqual({ autoRunsToday: false, currentStock: true });
    expect(factsNeeded(tool("update_stock"), auto())).toEqual({ autoRunsToday: false, currentStock: false });
    expect(factsNeeded(tool("update_stock"), { mode: "ASK", limits: { maxChange: 5 } })).toEqual({ autoRunsToday: false, currentStock: false });
  });
});

describe("order status limits", () => {
  it("only runs the statuses the owner allowed", () => {
    const policy = auto({ allowedStatuses: ["ready", "shipped"] });
    const run = (status: string) => decide({ tool: tool("update_order_status"), policy, storePaused: false, input: { orderId: "o", status } });
    expect(run("ready").outcome).toBe("RUN");
    expect(run("cancelled").outcome).toBe("APPROVAL");
  });
});

describe("daily caps", () => {
  it("counts today's automatic runs", () => {
    const policy = auto({ maxPerDay: 3 });
    const run = (autoRunsToday: number | undefined) =>
      decide({ tool: tool("reply_to_review"), policy, storePaused: false, input: { reviewId: "r", reply: "Thanks" }, facts: { autoRunsToday } });
    expect(run(2).outcome).toBe("RUN");
    expect(run(3).outcome).toBe("APPROVAL");
    expect(run(undefined).outcome).toBe("APPROVAL");
    expect(factsNeeded(tool("reply_to_review"), policy)).toEqual({ autoRunsToday: true, currentStock: false });
  });
});

describe("fail closed", () => {
  it("treats unreadable saved limits as a reason to ask", () => {
    expect(limitViolations("create_coupon", { maxPercent: "lots" }, {}, {})).toEqual(["the saved limits for this action are invalid"]);
    expect(decide({ tool: tool("create_coupon"), policy: auto({ surprise: true }), storePaused: false, input: {} }).outcome).toBe("APPROVAL");
  });
});

describe("settings validation", () => {
  it("accepts valid settings and strips nothing it needs", () => {
    expect(parsePolicySetting(tool("create_coupon"), { mode: "AUTO", limits: { maxPercent: 10, maxPerDay: 5 } })).toEqual({
      ok: true, value: { mode: "AUTO", limits: { maxPercent: 10, maxPerDay: 5 } },
    });
  });

  it("rejects modes a tool cannot have and bad limits", () => {
    expect(parsePolicySetting(tool("search_orders"), { mode: "ASK" }).ok).toBe(false);
    expect(parsePolicySetting(tool("create_coupon"), { mode: "AUTO", limits: { maxPercent: 0 } }).ok).toBe(false);
    expect(parsePolicySetting(tool("update_stock"), { mode: "BOGUS" }).ok).toBe(false);
  });
});
