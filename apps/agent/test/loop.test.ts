import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { basePrisma, createUser, dbForStore, dbForUser } from "@store-ops/db";
import type { AgentEvent } from "@store-ops/shared";
import { RunLimitError, runAgentLoop, type ModelClient, type ToolClient } from "../src/loop";
import { costUsd } from "../src/pricing";
import { runChat } from "../src/run";

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000 };

function reply(blocks: Block[], stop_reason?: string): Anthropic.Beta.BetaMessage {
  const content = blocks.map((b) => (b.type === "tool_use" ? { ...b, id: `toolu_${randomUUID().slice(0, 8)}` } : b));
  return {
    id: `msg_${randomUUID().slice(0, 8)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop_reason ?? (blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: USAGE,
  } as unknown as Anthropic.Beta.BetaMessage;
}

/** A model that plays back scripted replies and records what it was sent. */
function scripted(replies: (Anthropic.Beta.BetaMessage | ((signal: AbortSignal) => Promise<Anthropic.Beta.BetaMessage>))[]) {
  const requests: Parameters<ModelClient["turn"]>[0][] = [];
  const model: ModelClient = {
    async turn(request, { signal, onText }) {
      requests.push(structuredClone(request));
      const next = replies.shift() ?? reply([{ type: "text", text: "(no more script)" }]);
      const message = typeof next === "function" ? await next(signal) : next;
      for (const b of message.content) if (b.type === "text") onText(b.text);
      return message;
    },
  };
  return { model, requests };
}

function fakeTools(results: Record<string, string> = {}): ToolClient & { calls: string[]; close(): Promise<void> } {
  const calls: string[] = [];
  return {
    calls,
    async list() {
      return [
        { name: "search_orders", description: "", input_schema: { type: "object", properties: {} } },
        { name: "update_order_status", description: "", input_schema: { type: "object", properties: {} } },
      ];
    },
    async call(name) {
      calls.push(name);
      return { text: results[name] ?? JSON.stringify({ ok: true }), isError: false };
    },
    async close() {},
  };
}

const system = [{ type: "text" as const, text: "test" }];

describe("agent loop", () => {
  it("answers without tools", async () => {
    const { model } = scripted([reply([{ type: "text", text: "Sales were ₹4,200 yesterday." }])]);
    const events: AgentEvent[] = [];
    const result = await runAgentLoop({ model, tools: fakeTools(), system, history: [], message: "Sales?", emit: (e) => events.push(e) });
    expect(result.output).toBe("Sales were ₹4,200 yesterday.");
    expect(result.toolCalls).toBe(0);
    expect(events).toEqual([{ type: "text", delta: "Sales were ₹4,200 yesterday." }]);
  });

  it("runs a tool and sends the result back in one user message", async () => {
    const { model, requests } = scripted([
      reply([{ type: "text", text: "Checking." }, { type: "tool_use", name: "search_orders", input: { overdue: true } }]),
      reply([{ type: "text", text: "3 orders are late." }]),
    ]);
    const tools = fakeTools({ search_orders: JSON.stringify({ orders: [1, 2, 3] }) });
    const events: AgentEvent[] = [];
    const result = await runAgentLoop({ model, tools, system, history: [], message: "Late orders?", emit: (e) => events.push(e) });
    expect(result.output).toBe("Checking.\n\n3 orders are late.");
    expect(tools.calls).toEqual(["search_orders"]);
    const second = requests[1]!.messages;
    expect(second).toHaveLength(3);
    const toolResults = second[2]!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(toolResults[0]).toMatchObject({ type: "tool_result", content: JSON.stringify({ orders: [1, 2, 3] }) });
    expect(events.map((e) => e.type)).toEqual(["text", "tool_call", "tool_result", "text"]);
  });

  it("flags writes that are waiting for approval", async () => {
    const { model } = scripted([
      reply([{ type: "tool_use", name: "update_order_status", input: { orderId: "o1", status: "ready" } }]),
      reply([{ type: "text", text: "Waiting for your approval." }]),
    ]);
    const tools = fakeTools({ update_order_status: JSON.stringify({ status: "pending_approval", approvalId: "a1" }) });
    const events: AgentEvent[] = [];
    await runAgentLoop({ model, tools, system, history: [], message: "Mark o1 ready", emit: (e) => events.push(e) });
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ status: "pending_approval", isError: false });
  });

  it("stops calling tools after the limit and forces an answer", async () => {
    const greedy = () => reply([{ type: "tool_use", name: "search_orders", input: {} }, { type: "tool_use", name: "search_orders", input: {} }]);
    const { model, requests } = scripted([greedy(), greedy(), greedy(), reply([{ type: "text", text: "Here is what I found." }])]);
    const tools = fakeTools();
    const result = await runAgentLoop({
      model, tools, system, history: [], message: "Dig deep", emit: () => {}, limits: { maxToolCalls: 5 },
    });
    expect(tools.calls).toHaveLength(5);
    expect(result.toolCalls).toBe(5);
    // The sixth call is refused with an error result, and the next request offers no tool use.
    const refused = requests[3]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(refused.at(-1)).toMatchObject({ is_error: true });
    expect(requests[3]!.toolChoice).toBe("none");
    expect(result.output).toBe("Here is what I found.");
  });

  it("enforces the time limit", async () => {
    const slow = (signal: AbortSignal) =>
      new Promise<Anthropic.Beta.BetaMessage>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const { model } = scripted([slow]);
    await expect(
      runAgentLoop({ model, tools: fakeTools(), system, history: [], message: "Hi", emit: () => {}, limits: { timeLimitMs: 50 } }),
    ).rejects.toBeInstanceOf(RunLimitError);
  });

  it("handles a refusal without running tools", async () => {
    const { model } = scripted([reply([{ type: "tool_use", name: "search_orders", input: {} }], "refusal")]);
    const tools = fakeTools();
    const result = await runAgentLoop({ model, tools, system, history: [], message: "…", emit: () => {} });
    expect(tools.calls).toEqual([]);
    expect(result.stopReason).toBe("refusal");
  });

  it("passes earlier chat turns as history", async () => {
    const { model, requests } = scripted([reply([{ type: "text", text: "Yes." }])]);
    await runAgentLoop({
      model, tools: fakeTools(), system, emit: () => {}, message: "And today?",
      history: [{ role: "user", content: "Sales yesterday?" }, { role: "assistant", content: "₹4,200." }],
    });
    expect(requests[0]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("pricing", () => {
  it("prices cache reads, writes and output by the serving model", () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, cache write = 1.25 × input.
    const usd = costUsd("claude-opus-5-5", {
      input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 1_000_000,
    } as Anthropic.Beta.BetaUsage);
    expect(usd).toBeCloseTo(4 + 2 + 1 + 0.2, 6);
  });
});

describe("runChat trace", () => {
  afterAll(async () => {
    await basePrisma().$disconnect();
  });

  it("records the run, tokens, cost and monthly usage", async () => {
    const owner = await createUser(`agent-${randomUUID().slice(0, 8)}@test.local`, "Agent Owner", "x");
    const store = await dbForUser(owner).store.create({
      data: { ownerId: owner, platform: "SUPABASE", name: "Trace store", currency: "INR", timezone: "Asia/Kolkata" },
    });
    const { model } = scripted([
      reply([{ type: "tool_use", name: "search_orders", input: {} }]),
      reply([{ type: "text", text: "All good." }]),
    ]);
    const events: AgentEvent[] = [];
    const runId = await runChat({ storeId: store.id, message: "How are we doing?", history: [] }, (e) => events.push(e), {
      model,
      connectTools: async () => fakeTools(),
    });

    const run = await dbForStore(store.id).agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: "SUCCEEDED", output: "All good.", input: "How are we doing?", tokensIn: 10_000, tokensOut: 400 });
    expect(Number(run.costInr)).toBeGreaterThan(0);
    expect(run.finishedAt).not.toBeNull();
    const usage = await dbForStore(store.id).usage.findFirstOrThrow({ where: { storeId: store.id } });
    expect(usage.runs).toBe(1);
    expect(events[0]).toEqual({ type: "run", runId });
    expect(events.at(-1)).toMatchObject({ type: "done", toolCalls: 1 });
  });

  it("does not run for a paused store", async () => {
    const owner = await createUser(`agent-${randomUUID().slice(0, 8)}@test.local`, "Agent Owner", "x");
    const store = await dbForUser(owner).store.create({
      data: { ownerId: owner, platform: "SUPABASE", name: "Paused", currency: "INR", timezone: "UTC", isPaused: true },
    });
    const { model, requests } = scripted([]);
    const events: AgentEvent[] = [];
    const runId = await runChat({ storeId: store.id, message: "Hi", history: [] }, (e) => events.push(e), {
      model,
      connectTools: async () => fakeTools(),
    });
    expect(requests).toHaveLength(0);
    expect((await dbForStore(store.id).agentRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("CANCELLED");
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });
});
