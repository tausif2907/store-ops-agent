import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetBoutique } from "@store-ops/adapters/supabase-seed";
import { basePrisma, createUser, dbForStore, dbForUser } from "@store-ops/db";
import { createMcpHttpServer } from "@store-ops/mcp/http";
import { closeAdapters } from "@store-ops/mcp/server";
import type { AgentEvent } from "@store-ops/shared";
import { encryptJson } from "@store-ops/shared/crypto";
import { createAgentHttpServer } from "../src/http";
import type { ModelClient } from "../src/loop";
import { connectMcpTools } from "../src/mcp-tools";

/**
 * The whole server chain over HTTP: agent API (SSE) → MCP server → Supabase
 * adapter → boutique database. Only the model is scripted.
 */

const MCP_TOKEN = "mcp-e2e-".padEnd(40, "m");
const AGENT_TOKEN = "agent-e2e-".padEnd(40, "a");
const mcp = createMcpHttpServer({ token: MCP_TOKEN });
const seen: Anthropic.Beta.BetaTool[][] = [];

// Calls search_orders for overdue orders, then answers with the count it got back.
const model: ModelClient = {
  async turn({ messages, tools }, { onText }) {
    seen.push(tools);
    const last = messages.at(-1)!;
    const toolResult = Array.isArray(last.content) ? (last.content[0] as Anthropic.Beta.BetaToolResultBlockParam) : null;
    const base = { id: "msg_e2e", type: "message", role: "assistant", model: "claude-opus-5-5", stop_sequence: null,
      usage: { input_tokens: 500, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
    if (!toolResult) {
      return { ...base, stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_1", name: "search_orders", input: { overdue: true, limit: 50 } }] } as unknown as Anthropic.Beta.BetaMessage;
    }
    const body = JSON.parse(toolResult.content as string) as { result: { orders: unknown[] } };
    const text = `${body.result.orders.length} orders are overdue.`;
    onText(text);
    return { ...base, stop_reason: "end_turn", content: [{ type: "text", text }] } as unknown as Anthropic.Beta.BetaMessage;
  },
};

let agent: ReturnType<typeof createAgentHttpServer>;
let agentUrl: string;
let storeId: string;

beforeAll(async () => {
  await resetBoutique(process.env.BOUTIQUE_ADMIN_URL!);
  await new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve));
  process.env.MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
  process.env.MCP_INTERNAL_TOKEN = MCP_TOKEN;

  agent = createAgentHttpServer({ token: AGENT_TOKEN, deps: () => ({ model, connectTools: connectMcpTools }) });
  await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", resolve));
  agentUrl = `http://127.0.0.1:${(agent.address() as AddressInfo).port}`;

  const owner = await createUser(`e2e-${randomUUID().slice(0, 8)}@test.local`, "E2E Owner", "x");
  storeId = (
    await dbForUser(owner).store.create({
      data: {
        ownerId: owner, platform: "SUPABASE", name: "E2E store", currency: "INR", timezone: "Asia/Kolkata",
        connection: { create: { credentialsEncrypted: encryptJson({ connectionString: process.env.BOUTIQUE_AGENT_URL }), scopes: [] } },
      },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  agent.close();
  mcp.close();
  await closeAdapters();
  await basePrisma().$disconnect();
});

async function readSse(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)) as AgentEvent);
}

describe("agent API end to end", () => {
  it("rejects calls without the internal token", async () => {
    const res = await fetch(`${agentUrl}/runs`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("streams a run that reads real store data through MCP and traces it", async () => {
    const res = await fetch(`${agentUrl}/runs`, {
      method: "POST",
      headers: { authorization: `Bearer ${AGENT_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ storeId, message: "Which orders are late?" }),
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const events = await readSse(res);
    expect(events.map((e) => e.type)).toEqual(["run", "tool_call", "tool_result", "text", "done"]);

    // The model was offered the store's tools, with a cache breakpoint on the last one.
    expect(seen[0]!.map((t) => t.name)).toContain("search_orders");
    expect(seen[0]!.at(-1)!.cache_control).toEqual({ type: "ephemeral" });

    const runId = (events[0] as { runId: string }).runId;
    const run = await dbForStore(storeId).agentRun.findUniqueOrThrow({ where: { id: runId }, include: { toolCalls: true } });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.output).toMatch(/^\d+ orders are overdue\.$/);
    expect(Number(run.output!.split(" ")[0])).toBeGreaterThan(0);
    expect(run.toolCalls).toHaveLength(1);
    expect(run.toolCalls[0]).toMatchObject({ toolName: "search_orders", policyDecision: "AUTO" });
  });
});
