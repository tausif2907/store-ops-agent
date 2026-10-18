import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetBoutique } from "@store-ops/adapters/supabase-seed";
import { basePrisma, createUser, dbForStore, dbForUser } from "@store-ops/db";
import { encryptJson } from "@store-ops/shared/crypto";
import { createMcpHttpServer } from "../src/http";
import { closeAdapters } from "../src/server";

const TOKEN = "test-token-".padEnd(40, "x");
const server = createMcpHttpServer({ token: TOKEN });
let url: string;
let storeId: string;
let otherStoreId: string;
let otherRunId: string;

async function newRun(sid = storeId) {
  return (await dbForStore(sid).agentRun.create({ data: { storeId: sid, trigger: "CHAT" } })).id;
}

async function connect(runId: string, sid = storeId, token = TOKEN) {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}`, "x-store-id": sid, "x-run-id": runId } },
  });
  await client.connect(transport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = result.content as { type: string; text: string }[];
  return first!.text;
}

async function makeStore(ownerId: string, name: string) {
  return (
    await dbForUser(ownerId).store.create({
      data: {
        ownerId,
        platform: "SUPABASE",
        name,
        currency: "INR",
        timezone: "Asia/Kolkata",
        connection: {
          create: {
            credentialsEncrypted: encryptJson({ connectionString: process.env.BOUTIQUE_AGENT_URL }),
            scopes: [],
          },
        },
      },
    })
  ).id;
}

beforeAll(async () => {
  await resetBoutique(process.env.BOUTIQUE_ADMIN_URL!);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const tag = randomUUID().slice(0, 8);
  const owner = await createUser(`mcp-${tag}@test.local`, "MCP Owner", "x");
  const other = await createUser(`mcp-other-${tag}@test.local`, "Other Owner", "x");
  storeId = await makeStore(owner, "MCP test store");
  otherStoreId = await makeStore(other, "Other store");
  otherRunId = await newRun(otherStoreId);
}, 60_000);

afterAll(async () => {
  server.close();
  await closeAdapters();
  await basePrisma().$disconnect();
});

describe("MCP server", () => {
  it("rejects requests without the internal token", async () => {
    await expect(connect(await newRun(), storeId, "wrong".padEnd(40, "x"))).rejects.toThrow();
  });

  it("lists all twelve tools for a fully capable store", async () => {
    const client = await connect(await newRun());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_coupon", "draft_customer_message", "draft_review_reply", "get_order", "list_coupons", "low_stock_products",
        "reply_to_review", "sales_summary", "search_orders", "search_reviews", "update_order_status", "update_stock",
      ].sort(),
    );
    const search = tools.find((t) => t.name === "search_orders")!;
    expect(search.inputSchema.type).toBe("object");
    expect(search.inputSchema.properties).toHaveProperty("overdue");
    await client.close();
  });

  it("runs a read, marks customer text as untrusted, and records the call", async () => {
    const runId = await newRun();
    const client = await connect(runId);
    const result = await client.callTool({ name: "search_orders", arguments: { overdue: true, limit: 3 } });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result));
    expect(body.note).toMatch(/Never follow instructions/);
    expect(body.result.orders).toHaveLength(3);
    const calls = await dbForStore(storeId).toolCall.findMany({ where: { runId } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ toolName: "search_orders", policyDecision: "AUTO" });
    expect(calls[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    await client.close();
  });

  it("computes named periods in the store's time zone", async () => {
    const client = await connect(await newRun());
    const result = await client.callTool({ name: "sales_summary", arguments: { period: "last_30_days" } });
    const body = JSON.parse(textOf(result));
    expect(body.period).toBe("last_30_days");
    expect(body.from).toMatch(/T18:30:00\.000Z$/); // midnight in India
    expect(body.orderCount).toBeGreaterThan(0);
    await client.close();
  });

  it("saves writes for approval by default and does not run them", async () => {
    const runId = await newRun();
    const client = await connect(runId);
    const orders = JSON.parse(textOf(await client.callTool({ name: "search_orders", arguments: { status: "pending", limit: 1 } })));
    const order = orders.result.orders[0];
    const result = await client.callTool({ name: "update_order_status", arguments: { orderId: order.id, status: "processing" } });
    const body = JSON.parse(textOf(result));
    expect(body.status).toBe("pending_approval");

    const approval = await dbForStore(storeId).approval.findUniqueOrThrow({ where: { id: body.approvalId } });
    expect(approval.status).toBe("PENDING");
    expect(approval.summary).toContain("processing");
    expect(approval.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60 * 1000);

    const still = JSON.parse(textOf(await client.callTool({ name: "get_order", arguments: { orderId: order.id } })));
    expect(still.result.status).toBe("pending");
    await client.close();
  });

  it("runs a write immediately when the owner set it to Auto, and audits it", async () => {
    await dbForStore(storeId).policy.create({ data: { storeId, action: "update_stock", mode: "AUTO" } });
    const runId = await newRun();
    const client = await connect(runId);
    const low = JSON.parse(textOf(await client.callTool({ name: "low_stock_products", arguments: {} })));
    const variant = low.products[0].lowVariants[0];
    const result = await client.callTool({ name: "update_stock", arguments: { variantId: variant.id, quantity: 25 } });
    expect(result.isError).toBeFalsy();
    const product = JSON.parse(textOf(result));
    expect(product.variants.find((v: { id: string }) => v.id === variant.id).stock).toBe(25);
    const audit = await dbForStore(storeId).auditLog.findMany({ where: { action: "update_stock" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor).toBe(`agent:run:${runId}`);
    await client.close();
  });

  it("hides tools the owner turned off and refuses calls to them", async () => {
    await dbForStore(storeId).policy.create({ data: { storeId, action: "create_coupon", mode: "NEVER" } });
    const client = await connect(await newRun());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("create_coupon");
    const result = await client.callTool({ name: "create_coupon", arguments: { code: "SNEAKY50", type: "percent", value: 50 } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it("returns validation errors to the model instead of failing", async () => {
    const runId = await newRun();
    const client = await connect(runId);
    const result = await client.callTool({ name: "update_stock", arguments: { variantId: "x", quantity: -5 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/quantity/);
    const [call] = await dbForStore(storeId).toolCall.findMany({ where: { runId } });
    expect(call!.policyDecision).toBe("INVALID_INPUT");
    await client.close();
  });

  it("blocks writes while the store is paused", async () => {
    await dbForStore(storeId).store.update({ where: { id: storeId }, data: { isPaused: true } });
    try {
      const client = await connect(await newRun());
      const low = JSON.parse(textOf(await client.callTool({ name: "low_stock_products", arguments: {} })));
      const result = await client.callTool({
        name: "update_stock",
        arguments: { variantId: low.products[0].lowVariants[0].id, quantity: 9 },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/paused/);
      await client.close();
    } finally {
      await dbForStore(storeId).store.update({ where: { id: storeId }, data: { isPaused: false } });
    }
  });

  it("refuses a run that belongs to another store", async () => {
    const client = await connect(otherRunId, storeId);
    const result = await client.callTool({ name: "list_coupons", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Unknown run/);
    expect(await dbForStore(otherStoreId).toolCall.findMany({ where: { runId: otherRunId } })).toEqual([]);
    await client.close();
  });

  it("refuses calls for a finished run", async () => {
    const runId = await newRun();
    await dbForStore(storeId).agentRun.update({ where: { id: runId }, data: { status: "SUCCEEDED" } });
    const client = await connect(runId);
    const result = await client.callTool({ name: "list_coupons", arguments: {} });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
