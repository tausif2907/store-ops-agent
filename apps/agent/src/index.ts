// Agent API: runs the agent loop for chat requests and streams events back.
import { anthropicModel, checkClaudeAccess } from "./anthropic-model";
import { createAgentHttpServer } from "./http";
import { connectMcpTools } from "./mcp-tools";

const port = Number(process.env.AGENT_PORT ?? 3200);
const token = process.env.AGENT_INTERNAL_TOKEN;
if (!token) throw new Error("AGENT_INTERNAL_TOKEN is not set");

void checkClaudeAccess().then((r) => (r.ok ? console.log(`Claude API key works with ${r.model}`) : console.error(`Runs will fail: ${r.message}`)));

const model = anthropicModel();
const server = createAgentHttpServer({ token, deps: () => ({ model, connectTools: connectMcpTools }) });
server.listen(port, process.env.AGENT_HOST ?? "127.0.0.1", () => {
  console.log(`Agent API listening on http://${process.env.AGENT_HOST ?? "127.0.0.1"}:${port}`);
});
