import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { AgentEvent } from "@store-ops/shared";
import { runChat, type RunDeps } from "./run";

/**
 * Internal agent API. The dashboard's server calls POST /runs after checking
 * the signed-in owner owns the store; the browser never reaches this service.
 */

const RunRequest = z.object({
  storeId: z.uuid(),
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});

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
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createAgentHttpServer(options: { token: string; deps: () => RunDeps }): Server {
  if (options.token.length < 32) throw new Error("AGENT_INTERNAL_TOKEN must be at least 32 characters");

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (url.pathname !== "/runs") return sendJson(res, 404, { error: "Not found" });
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST" });
    if (!tokenMatches(req.headers.authorization, options.token)) return sendJson(res, 401, { error: "Unauthorized" });

    let body: z.infer<typeof RunRequest>;
    try {
      body = RunRequest.parse(await readJson(req));
    } catch {
      return sendJson(res, 400, { error: "Invalid request" });
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const emit = (event: AgentEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await runChat({ ...body, signal: abort.signal }, emit, options.deps());
    } catch (err) {
      console.error("Run could not start", err);
      emit({ type: "error", message: "The run could not start." });
    } finally {
      res.end();
    }
  });
}
