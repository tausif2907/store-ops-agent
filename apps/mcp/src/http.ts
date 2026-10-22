import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server";
import { errorSummary } from "@store-ops/shared";

/**
 * Internal-only MCP endpoint (POST /mcp). Reachable by the agent API and the
 * worker with a bearer token. The store and run come from headers set by
 * those services, never from the model.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1_000_000;

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createMcpHttpServer(options: { token: string }): HttpServer {
  if (options.token.length < 32) throw new Error("MCP_INTERNAL_TOKEN must be at least 32 characters");

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (url.pathname !== "/mcp") return sendJson(res, 404, { error: "Not found" });
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
    if (!tokenMatches(req.headers.authorization, options.token)) return sendJson(res, 401, { error: "Unauthorized" });

    const storeId = req.headers["x-store-id"];
    const runId = req.headers["x-run-id"];
    if (typeof storeId !== "string" || !UUID.test(storeId) || typeof runId !== "string" || !UUID.test(runId)) {
      return sendJson(res, 400, { error: "x-store-id and x-run-id headers are required" });
    }

    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body" });
    }

    const server = createMcpServer({ storeId, runId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("MCP request failed", errorSummary(err));
      if (!res.headersSent) sendJson(res, 500, { error: "Internal error" });
    }
  });
}
