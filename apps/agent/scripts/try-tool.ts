/**
 * Calls one tool through the MCP server exactly as the agent would, without a
 * model. Useful for checking rules and approvals locally.
 *
 *   pnpm --filter @store-ops/agent try-tool <storeId> <tool> '<json input>'
 */
import { dbForStore } from "@store-ops/db";
import { connectMcpTools } from "../src/mcp-tools";

const [storeId, tool, rawInput = "{}"] = process.argv.slice(2);
if (!storeId || !tool) {
  console.error("Usage: try-tool <storeId> <tool> '<json input>'");
  process.exit(1);
}

const db = dbForStore(storeId);
const run = await db.agentRun.create({ data: { storeId, trigger: "CHAT", input: `try-tool ${tool}` } });
const tools = await connectMcpTools({ storeId, runId: run.id });
try {
  const result = await tools.call(tool, JSON.parse(rawInput));
  console.log(result.isError ? "ERROR:" : "OK:", result.text);
} finally {
  await tools.close();
  await db.agentRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", output: "(try-tool)", finishedAt: new Date() } });
}
process.exit(0);
