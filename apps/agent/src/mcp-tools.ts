import type Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolClient } from "./loop";

/**
 * The store's tools for one run, from the internal MCP server. The store and
 * run travel in headers this service sets; the model only ever picks a tool
 * name and its arguments.
 */
export async function connectMcpTools(ctx: { storeId: string; runId: string }): Promise<ToolClient & { close(): Promise<void> }> {
  // A host may give just "host:port" for a private service.
  const configured = process.env.MCP_URL ?? "http://127.0.0.1:3201/mcp";
  const url = configured.includes("://") ? configured : `http://${configured}/mcp`;
  const token = process.env.MCP_INTERNAL_TOKEN;
  if (!token) throw new Error("MCP_INTERNAL_TOKEN is not set");

  const client = new Client({ name: "store-ops-agent", version: "0.2.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}`, "x-store-id": ctx.storeId, "x-run-id": ctx.runId } },
    }),
  );

  return {
    async list() {
      const { tools } = await client.listTools();
      const defs: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      }));
      // The last tool carries the cache breakpoint for the tools + system prefix.
      const last = defs.at(-1);
      if (last) last.cache_control = { type: "ephemeral" };
      return defs;
    },
    async call(name, input) {
      const result = await client.callTool({ name, arguments: (input ?? {}) as Record<string, unknown> });
      const text = (result.content as { type: string; text?: string }[])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return { text, isError: result.isError === true };
    },
    close: () => client.close(),
  };
}
