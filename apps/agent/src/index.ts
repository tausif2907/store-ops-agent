// Agent API: runs the agent loop for chat requests and streams events back.
import { anthropicModel } from "./anthropic-model";
import { createAgentHttpServer } from "./http";
import { connectMcpTools } from "./mcp-tools";

const port = Number(process.env.AGENT_PORT ?? 3200);
const token = process.env.AGENT_INTERNAL_TOKEN;
if (!token) throw new Error("AGENT_INTERNAL_TOKEN is not set");

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("ANTHROPIC_API_KEY is not set: runs will fail unless an `ant auth login` profile is available.");
}

const model = anthropicModel();
const server = createAgentHttpServer({ token, deps: () => ({ model, connectTools: connectMcpTools }) });
server.listen(port, process.env.AGENT_HOST ?? "127.0.0.1", () => {
  console.log(`Agent API listening on http://${process.env.AGENT_HOST ?? "127.0.0.1"}:${port}`);
});
