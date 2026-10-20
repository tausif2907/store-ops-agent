import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "@store-ops/agent/loop";
import { connectMcpTools } from "@store-ops/agent/mcp-tools";
import { createUser, dbForUser } from "@store-ops/db";
import { createMcpHttpServer } from "@store-ops/mcp/http";
import { encryptJson } from "@store-ops/shared/crypto";
import { ensureDefaultJobs } from "@store-ops/tools";

/** Starts the real MCP server in-process and points the agent's MCP client at it. */
export async function startMcp() {
  const token = "worker-test-".padEnd(40, "w");
  const server = createMcpHttpServer({ token });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.MCP_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  process.env.MCP_INTERNAL_TOKEN = token;
  return server;
}

/** A connected boutique store with its default jobs. */
export async function makeStore(opts: { paused?: boolean } = {}) {
  const tag = randomUUID().slice(0, 8);
  const owner = await createUser(`worker-${tag}@test.local`, "Worker Owner", "x");
  const db = dbForUser(owner);
  const store = await db.store.create({
    data: {
      ownerId: owner,
      platform: "SUPABASE",
      name: `Worker store ${tag}`,
      currency: "INR",
      timezone: "Asia/Kolkata",
      isPaused: opts.paused ?? false,
      connection: { create: { credentialsEncrypted: encryptJson({ connectionString: process.env.BOUTIQUE_AGENT_URL }), scopes: [] } },
    },
  });
  await ensureDefaultJobs(db, store.id);
  return { ownerId: owner, ownerEmail: `worker-${tag}@test.local`, storeId: store.id };
}

type ToolCall = { name: string; input: Record<string, unknown> };

/**
 * A model that, on its first turn, makes the tool calls `plan` derives from
 * the job's message, then answers with fixed text. Records every request.
 */
export function scriptedModel(plan: (message: string) => ToolCall[], answer = "## Summary\n\nAll handled.") {
  const prompts: string[] = [];
  const toolResults: string[] = [];
  const model: ModelClient = {
    async turn({ messages }, { onText }) {
      const last = messages.at(-1)!;
      const base = {
        id: `msg_${randomUUID().slice(0, 8)}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
      if (typeof last.content === "string") {
        prompts.push(last.content);
        const calls = plan(last.content);
        if (calls.length) {
          return {
            ...base,
            stop_reason: "tool_use",
            content: calls.map((c) => ({ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: c.name, input: c.input })),
          } as unknown as Anthropic.Beta.BetaMessage;
        }
      } else {
        for (const block of last.content as Anthropic.Beta.BetaToolResultBlockParam[]) toolResults.push(String(block.content));
      }
      onText(answer);
      return { ...base, stop_reason: "end_turn", content: [{ type: "text", text: answer }] } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
  return { model, prompts, toolResults, deps: { model, connectTools: connectMcpTools } };
}

/** Pulls `(id X)` order ids or `Review X` ids out of a job message. */
export const orderIds = (message: string) => [...message.matchAll(/\(id ([^)]+)\)/g)].map((m) => m[1]!);
export const reviewIds = (message: string) => [...message.matchAll(/^- Review (\S+?)[ ,(]/gm)].map((m) => m[1]!);
