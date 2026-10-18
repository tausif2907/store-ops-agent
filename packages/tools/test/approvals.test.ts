import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseAdapter } from "@store-ops/adapters";
import { resetBoutique } from "@store-ops/adapters/supabase-seed";
import { basePrisma, createUser, dbForStore, dbForUser, storeOwnerContact } from "@store-ops/db";
import { encryptJson } from "@store-ops/shared/crypto";
import { decideApproval, expireStaleApprovals, requestApproval } from "../src/approvals";
import { signApprovalLink, verifyApprovalLink } from "../src/approval-link";
import { getTool } from "../src/catalog";

let ownerId: string;
let ownerEmail: string;
let storeId: string;
let runId: string;
let boutique: SupabaseAdapter;

async function pendingStockChange(quantity: number, variantId: string) {
  const db = dbForStore(storeId);
  const call = await db.toolCall.create({
    data: { runId, toolName: "update_stock", args: { variantId, quantity }, policyDecision: "ASK" },
  });
  return requestApproval({ storeId, toolCallId: call.id, tool: getTool("update_stock")!, input: { variantId, quantity }, reason: null });
}

async function trackedVariant() {
  const page = await boutique.listProducts({ lowStockThreshold: 3 });
  return page.items[0]!.variants.find((v) => v.stock !== null && v.stock <= 3)!;
}

beforeAll(async () => {
  await resetBoutique(process.env.BOUTIQUE_ADMIN_URL!);
  boutique = new SupabaseAdapter({ connectionString: process.env.BOUTIQUE_AGENT_URL! });
  ownerEmail = `approvals-${randomUUID().slice(0, 8)}@test.local`;
  ownerId = await createUser(ownerEmail, "Approval Owner", "x");
  storeId = (
    await dbForUser(ownerId).store.create({
      data: {
        ownerId, platform: "SUPABASE", name: "Approvals store", currency: "INR", timezone: "Asia/Kolkata",
        connection: { create: { credentialsEncrypted: encryptJson({ connectionString: process.env.BOUTIQUE_AGENT_URL }), scopes: [] } },
      },
    })
  ).id;
  runId = (await dbForStore(storeId).agentRun.create({ data: { storeId, trigger: "CHAT" } })).id;
}, 60_000);

afterAll(async () => {
  await boutique.close();
  await basePrisma().$disconnect();
});

describe("approvals", () => {
  it("expose the owner's contact only to that store's context", async () => {
    expect(await storeOwnerContact(storeId)).toEqual({ email: ownerEmail, name: "Approval Owner" });
    expect(await storeOwnerContact(randomUUID())).toBeNull();
  });

  it("saves a pending approval that expires in 30 minutes", async () => {
    const variant = await trackedVariant();
    const approval = await pendingStockChange(30, variant.id);
    expect(approval.status).toBe("PENDING");
    expect(approval.summary).toContain("30");
    expect(approval.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  });

  it("runs the exact saved change when approved, once, and audits it", async () => {
    const variant = await trackedVariant();
    const approval = await pendingStockChange(42, variant.id);
    const result = await decideApproval({ storeId, approvalId: approval.id, decision: "APPROVE", userId: ownerId, via: "dashboard" });
    expect(result).toMatchObject({ ok: true, status: "EXECUTED" });

    const product = await boutique.getProductByVariant(variant.id);
    expect(product.variants.find((v) => v.id === variant.id)?.stock).toBe(42);

    const saved = await dbForStore(storeId).approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(saved).toMatchObject({ status: "EXECUTED", decidedBy: ownerId });
    const audit = await dbForStore(storeId).auditLog.findFirstOrThrow({ where: { storeId, action: "update_stock" } });
    expect(audit.actor).toBe(`user:${ownerId}`);

    // A second click (or a reused email link) does nothing.
    const again = await decideApproval({ storeId, approvalId: approval.id, decision: "APPROVE", userId: ownerId, via: "email" });
    expect(again).toMatchObject({ ok: false, status: "EXECUTED" });
  });

  it("changes nothing when rejected", async () => {
    const variant = await trackedVariant();
    const before = variant.stock;
    const approval = await pendingStockChange(99, variant.id);
    const result = await decideApproval({ storeId, approvalId: approval.id, decision: "REJECT", userId: ownerId, via: "dashboard" });
    expect(result).toMatchObject({ ok: true, status: "REJECTED" });
    const product = await boutique.getProductByVariant(variant.id);
    expect(product.variants.find((v) => v.id === variant.id)?.stock).toBe(before);
  });

  it("cannot approve after expiry", async () => {
    const variant = await trackedVariant();
    const approval = await pendingStockChange(7, variant.id);
    await dbForStore(storeId).approval.update({ where: { id: approval.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireStaleApprovals(storeId)).toBeGreaterThanOrEqual(1);
    const result = await decideApproval({ storeId, approvalId: approval.id, decision: "APPROVE", userId: ownerId, via: "dashboard" });
    expect(result).toMatchObject({ ok: false, status: "EXPIRED" });
  });

  it("refuses to approve while the store is paused", async () => {
    const variant = await trackedVariant();
    const approval = await pendingStockChange(8, variant.id);
    await dbForStore(storeId).store.update({ where: { id: storeId }, data: { isPaused: true } });
    try {
      const result = await decideApproval({ storeId, approvalId: approval.id, decision: "APPROVE", userId: ownerId, via: "dashboard" });
      expect(result).toMatchObject({ ok: false, status: "PAUSED" });
      expect((await dbForStore(storeId).approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("PENDING");
    } finally {
      await dbForStore(storeId).store.update({ where: { id: storeId }, data: { isPaused: false } });
    }
  });

  it("records a store-side failure without losing the decision", async () => {
    const approval = await pendingStockChange(5, "no-such-variant");
    const result = await decideApproval({ storeId, approvalId: approval.id, decision: "APPROVE", userId: ownerId, via: "dashboard" });
    expect(result).toMatchObject({ ok: false, status: "FAILED" });
    const saved = await dbForStore(storeId).approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(saved.status).toBe("FAILED");
    expect(saved.error).toMatch(/NOT_FOUND/);
  });

  it("only finds approvals within the given store", async () => {
    const variant = await trackedVariant();
    const approval = await pendingStockChange(11, variant.id);
    const other = await createUser(`other-${randomUUID().slice(0, 8)}@test.local`, "Other", "x");
    const otherStore = await dbForUser(other).store.create({
      data: { ownerId: other, platform: "SUPABASE", name: "Other", currency: "INR", timezone: "UTC" },
    });
    const result = await decideApproval({ storeId: otherStore.id, approvalId: approval.id, decision: "APPROVE", userId: other, via: "dashboard" });
    expect(result).toMatchObject({ ok: false, status: "NOT_FOUND" });
  });
});

describe("approval links", () => {
  const claims = { approvalId: randomUUID(), storeId: randomUUID(), ownerId: randomUUID() };

  it("round-trip their claims", async () => {
    const token = await signApprovalLink(claims, new Date(Date.now() + 60_000));
    expect(await verifyApprovalLink(token)).toEqual(claims);
  });

  it("reject expired, altered and foreign tokens", async () => {
    expect(await verifyApprovalLink(await signApprovalLink(claims, new Date(Date.now() - 1000)))).toBeNull();
    const token = await signApprovalLink(claims, new Date(Date.now() + 60_000));
    const [h, p, s] = token.split(".");
    const tampered = JSON.parse(Buffer.from(p!, "base64url").toString());
    tampered.sid = randomUUID();
    expect(await verifyApprovalLink(`${h}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${s}`)).toBeNull();
    expect(await verifyApprovalLink("not-a-token")).toBeNull();
  });
});
