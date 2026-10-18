// MCP server: routes the agent's tool calls to the run's store adapter through the policy check.
import { createMcpHttpServer } from "./http";
import { closeAdapters } from "./server";

const port = Number(process.env.MCP_PORT ?? 3201);
const token = process.env.MCP_INTERNAL_TOKEN;
if (!token) throw new Error("MCP_INTERNAL_TOKEN is not set");

const server = createMcpHttpServer({ token });
// Internal only: bind to loopback unless told otherwise.
server.listen(port, process.env.MCP_HOST ?? "127.0.0.1", () => {
  console.log(`MCP server listening on http://${process.env.MCP_HOST ?? "127.0.0.1"}:${port}/mcp`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    void closeAdapters().finally(() => process.exit(0));
  });
}
