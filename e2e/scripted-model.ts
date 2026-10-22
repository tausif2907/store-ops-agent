import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "@store-ops/agent/loop";

/**
 * Stands in for Claude so the browser test runs without an API key. It plays
 * the agent's part for the requests the test makes, using the tools for real:
 * the digest is written from what the store's own tools return.
 */

type ToolUse = { name: string; input: Record<string, unknown> };

export const E2E_COUPON = { code: "E2E15", type: "percent", value: 15, usageLimit: 50 } as const;

function message(stopReason: "tool_use" | "end_turn", content: unknown[]): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${randomUUID().slice(0, 8)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_sequence: null,
    stop_reason: stopReason,
    content,
    usage: { input_tokens: 1200, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** The first turn: which tools to call for this request. */
function plan(request: string): ToolUse[] {
  if (request.includes("morning's digest")) {
    return [
      { name: "sales_summary", input: { period: "yesterday" } },
      { name: "search_orders", input: { overdue: true, limit: 50 } },
    ];
  }
  if (/coupon/i.test(request)) return [{ name: "create_coupon", input: { ...E2E_COUPON } }];
  return [];
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** The final turn: an answer written from the tool results. */
function answer(request: string, results: Map<string, unknown>): string {
  if (request.includes("morning's digest")) {
    const sales = results.get("sales_summary") as { orderCount: number; grossSales: { amount: number } };
    const late = (results.get("search_orders") as { result: { orders: { number: string }[] } }).result.orders;
    return [
      `**Good morning.** Yesterday brought ${sales.orderCount} orders worth ${rupees(sales.grossSales.amount)}.`,
      "",
      "## Late orders",
      late.length ? `${late.length} orders are past their promised date, starting with ${late.slice(0, 3).map((o) => o.number).join(", ")}.` : "None.",
      "",
      "## Today's focus",
      "Follow up on the late orders first.",
    ].join("\n");
  }
  if (/coupon/i.test(request)) {
    const pending = results.get("create_coupon") as { status?: string } | undefined;
    return pending?.status === "pending_approval"
      ? `The coupon ${E2E_COUPON.code} (15% off, up to 50 uses) is waiting for your approval.`
      : `I could not create the coupon.`;
  }
  return "I can help with orders, sales, stock, coupons and reviews.";
}

export function scriptedModel(): ModelClient {
  return {
    async turn({ messages }, { onText }) {
      const request = messages.findLast((m) => m.role === "user" && typeof m.content === "string")?.content as string;
      const last = messages.at(-1)!;
      if (typeof last.content === "string") {
        const calls = plan(request);
        if (calls.length) {
          return message("tool_use", calls.map((c) => ({ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: c.name, input: c.input })));
        }
      }
      // Match each tool result to the call it answers, in the previous assistant turn.
      const uses = (messages.at(-2)?.content ?? []) as Anthropic.Beta.BetaContentBlockParam[];
      const results = new Map<string, unknown>();
      for (const block of Array.isArray(last.content) ? (last.content as Anthropic.Beta.BetaToolResultBlockParam[]) : []) {
        const use = uses.find((u) => u.type === "tool_use" && u.id === block.tool_use_id) as Anthropic.Beta.BetaToolUseBlockParam | undefined;
        if (!use) continue;
        try {
          results.set(use.name, JSON.parse(String(block.content)));
        } catch {
          results.set(use.name, { error: String(block.content) }); // tool errors are plain text
        }
      }
      const text = answer(request, results);
      onText(text);
      return message("end_turn", [{ type: "text", text }]);
    },
  };
}
