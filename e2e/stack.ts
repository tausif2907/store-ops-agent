/**
 * The services behind the dashboard, for the browser test: the MCP server,
 * the agent API and the job worker, as in production, with a scripted model
 * in place of Claude. Ports and tokens come from playwright.config.ts.
 */
import { createAgentHttpServer } from "@store-ops/agent/http";
import { connectMcpTools } from "@store-ops/agent/mcp-tools";
import { createMcpHttpServer } from "@store-ops/mcp/http";
import { JOB_TYPES, redisConnection } from "@store-ops/tools";
import { createJobWorker } from "@store-ops/worker/workers";
import { scriptedModel } from "./scripted-model";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const mcpUrl = new URL(env("MCP_URL"));
const agentUrl = new URL(env("AGENT_URL"));
const deps = { model: scriptedModel(), connectTools: connectMcpTools };

const mcp = createMcpHttpServer({ token: env("MCP_INTERNAL_TOKEN") });
mcp.listen(Number(mcpUrl.port), mcpUrl.hostname);
const agent = createAgentHttpServer({ token: env("AGENT_INTERNAL_TOKEN"), deps: () => deps });
agent.listen(Number(agentUrl.port), agentUrl.hostname);
const workers = JOB_TYPES.map((type) => createJobWorker(type, { connection: redisConnection(), deps }));
for (const w of workers) w.on("failed", (job, err) => console.error(`${w.name} job ${job?.id} failed:`, err.message));

console.log(`e2e stack: agent ${agentUrl.origin}, MCP ${mcpUrl.href}, ${workers.length} job workers`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    mcp.close();
    agent.close();
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}
