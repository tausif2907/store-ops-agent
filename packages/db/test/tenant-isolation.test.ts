import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EmailTakenError,
  applySubscriptionEvent,
  basePrisma,
  connectedStoreIds,
  consumePasswordReset,
  createPasswordReset,
  createUser,
  dbForStore,
  dbForUser,
  findUserForLogin,
  ownerEntitlementForStore,
  ownerEntitlementForUser,
  setUserPasswordHash,
  startSubscription,
  storeIdForExternal,
} from "../src/index";

/**
 * Store A's context tries to reach store B's data by every route the platform
 * database offers. Pass condition: zero leaks.
 */

let userA: string;
let userB: string;
let storeA: string;
let storeB: string;
let runB: string;

beforeAll(async () => {
  const tag = randomUUID().slice(0, 8);
  userA = await createUser(`a-${tag}@test.local`, "Owner A", "hash-a");
  userB = await createUser(`b-${tag}@test.local`, "Owner B", "hash-b");

  storeA = (await dbForUser(userA).store.create({
    data: { ownerId: userA, platform: "SUPABASE", name: "Store A", currency: "INR", timezone: "Asia/Kolkata" },
  })).id;
  storeB = (await dbForUser(userB).store.create({
    data: { ownerId: userB, platform: "SUPABASE", name: "Store B", currency: "INR", timezone: "Asia/Kolkata" },
  })).id;

  const dbB = dbForUser(userB);
  await dbB.storeConnection.create({ data: { storeId: storeB, credentialsEncrypted: "v1.secret", scopes: [] } });
  await dbB.policy.create({ data: { storeId: storeB, action: "create_coupon", mode: "ASK" } });
  runB = (await dbB.agentRun.create({ data: { storeId: storeB, trigger: "CHAT" } })).id;
  const call = await dbB.toolCall.create({
    data: { runId: runB, toolName: "create_coupon", args: { code: "X" }, policyDecision: "ASK" },
  });
  await dbB.approval.create({
    data: { toolCallId: call.id, args: {}, summary: "coupon", expiresAt: new Date(Date.now() + 60_000) },
  });
  await dbB.auditLog.create({ data: { storeId: storeB, actor: "test", action: "seed" } });
  await dbB.store.update({ where: { id: storeB }, data: { externalId: `b-${tag}.myshopify.com` } });
  await dbForStore(storeB).webhookEvent.create({ data: { storeId: storeB, topic: "orders/create", deliveryId: "d1", payload: {} } });
});

afterAll(async () => {
  await basePrisma().$disconnect();
});

describe("tenant isolation", () => {
  it("each owner sees only their own store", async () => {
    const stores = await dbForUser(userA).store.findMany();
    expect(stores.map((s) => s.id)).toEqual([storeA]);
  });

  it("no context means no rows", async () => {
    expect(await basePrisma().store.findMany()).toEqual([]);
    expect(await basePrisma().storeConnection.findMany()).toEqual([]);
  });

  it("owner A cannot read any of store B's rows", async () => {
    const dbA = dbForUser(userA);
    expect(await dbA.store.findUnique({ where: { id: storeB } })).toBeNull();
    expect(await dbA.storeConnection.findMany({ where: { storeId: storeB } })).toEqual([]);
    expect(await dbA.policy.findMany({ where: { storeId: storeB } })).toEqual([]);
    expect(await dbA.agentRun.findMany({ where: { storeId: storeB } })).toEqual([]);
    expect(await dbA.toolCall.findMany({ where: { runId: runB } })).toEqual([]);
    expect(await dbA.approval.findMany()).toEqual([]);
    expect(await dbA.auditLog.findMany({ where: { storeId: storeB } })).toEqual([]);
  });

  it("drafts stay with their store", async () => {
    await dbForStore(storeB).draft.create({
      data: { storeId: storeB, kind: "CUSTOMER_MESSAGE", targetId: "o1", targetLabel: "Order 1", body: "Sorry" },
    });
    expect(await dbForUser(userA).draft.findMany()).toEqual([]);
    expect(await dbForStore(storeA).draft.findMany()).toEqual([]);
    await expect(
      dbForStore(storeA).draft.create({ data: { storeId: storeB, kind: "REVIEW_REPLY", targetId: "r1", targetLabel: "R", body: "x" } }),
    ).rejects.toThrow();
  });

  it("the worker's store lookup returns ids only", async () => {
    const ids = await connectedStoreIds();
    expect(ids).toContain(storeB);
    expect(await basePrisma().store.findMany()).toEqual([]);
  });

  it("webhook events stay with their store", async () => {
    expect(await dbForUser(userA).webhookEvent.findMany()).toEqual([]);
    expect(await dbForStore(storeA).webhookEvent.findMany()).toEqual([]);
    await expect(
      dbForStore(storeA).webhookEvent.create({ data: { storeId: storeB, topic: "x", deliveryId: "d2", payload: {} } }),
    ).rejects.toThrow();
  });

  it("the external-id lookup returns only a store id", async () => {
    const b = await dbForUser(userB).store.findUniqueOrThrow({ where: { id: storeB } });
    expect(await storeIdForExternal("SHOPIFY", b.externalId!)).toBeNull(); // platform must match too
    expect(await storeIdForExternal("SUPABASE", b.externalId!)).toBe(storeB);
    expect(await storeIdForExternal("SUPABASE", "nope.myshopify.com")).toBeNull();
  });

  it("owner A cannot read owner B's user row", async () => {
    expect(await dbForUser(userA).user.findUnique({ where: { id: userB } })).toBeNull();
    expect((await dbForUser(userA).user.findMany()).map((u) => u.id)).toEqual([userA]);
  });

  it("owner A cannot write into store B", async () => {
    const dbA = dbForUser(userA);
    await expect(dbA.policy.create({ data: { storeId: storeB, action: "update_stock", mode: "AUTO" } })).rejects.toThrow();
    await expect(dbA.agentRun.create({ data: { storeId: storeB, trigger: "CHAT" } })).rejects.toThrow();
    await expect(dbA.toolCall.create({ data: { runId: runB, toolName: "x", args: {}, policyDecision: "AUTO" } })).rejects.toThrow();
    const updated = await dbA.store.updateMany({ where: { id: storeB }, data: { isPaused: true } });
    expect(updated.count).toBe(0);
    const deleted = await dbA.store.deleteMany({ where: { id: storeB } });
    expect(deleted.count).toBe(0);
  });

  it("owner A cannot create a store owned by someone else", async () => {
    await expect(
      dbForUser(userA).store.create({
        data: { ownerId: userB, platform: "SHOPIFY", name: "Sneaky", currency: "INR", timezone: "UTC" },
      }),
    ).rejects.toThrow();
  });

  it("owner A cannot move their store to owner B", async () => {
    await expect(dbForUser(userA).store.update({ where: { id: storeA }, data: { ownerId: userB } })).rejects.toThrow();
  });

  it("a store-scoped context sees exactly that store", async () => {
    const dbStoreA = dbForStore(storeA);
    expect((await dbStoreA.store.findMany()).map((s) => s.id)).toEqual([storeA]);
    expect(await dbStoreA.storeConnection.findMany({ where: { storeId: storeB } })).toEqual([]);
    expect(await dbStoreA.agentRun.findMany()).toEqual([]);
  });

  it("the audit log is append-only for the app", async () => {
    const dbB = dbForUser(userB);
    await expect(dbB.auditLog.deleteMany({ where: { storeId: storeB } })).rejects.toThrow();
  });

  it("refuses a second account with the same email, whatever its case", async () => {
    const email = (await dbForUser(userA).user.findUniqueOrThrow({ where: { id: userA } })).email;
    await expect(createUser(email.toUpperCase(), "Copy", "x")).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("a password reset changes only that account's hash", async () => {
    const emailA = (await dbForUser(userA).user.findUniqueOrThrow({ where: { id: userA } })).email;
    const emailB = (await dbForUser(userB).user.findUniqueOrThrow({ where: { id: userB } })).email;
    expect(await setUserPasswordHash(emailA.toUpperCase(), "new-hash-a")).toBe(true);
    expect((await findUserForLogin(emailA))?.password_hash).toBe("new-hash-a");
    expect((await findUserForLogin(emailB))?.password_hash).toBe("hash-b");
    expect(await setUserPasswordHash("nobody@test.local", "x")).toBe(false);
  });

  it("plans: an owner's entitlement counts only their own stores and spend", async () => {
    await dbForStore(storeB).usage.create({ data: { storeId: storeB, month: new Date().toISOString().slice(0, 7), runs: 1, tokens: 10, costInr: 42.5 } });
    const forB = await ownerEntitlementForStore(storeB);
    expect(forB).toMatchObject({ plan: "trial", planStatus: "trialing", storeCount: 1, monthSpendInr: 42.5 });
    const forA = await ownerEntitlementForUser(userA);
    expect(forA).toMatchObject({ storeCount: 1, monthSpendInr: 0 });
    expect(await basePrisma().$queryRaw`SELECT * FROM app_owner_entitlement()`).toEqual([]); // no context, no answer
  });

  it("plans: the app cannot change an account's plan, only billing can", async () => {
    await expect(dbForUser(userA).user.update({ where: { id: userA }, data: { plan: "growth" } })).rejects.toThrow(/permission denied/);
    await expect(basePrisma().$queryRaw`SELECT app_admin_set_plan('x@test.local', 'custom', 'active', NULL, NULL)`).rejects.toThrow(/permission denied/);
    await startSubscription(userA, `sub_${userA.slice(0, 8)}`, "growth");
    expect(await applySubscriptionEvent({ subscriptionId: `sub_${userA.slice(0, 8)}`, plan: "growth", status: "active", renewsAt: null })).toBe(true);
    expect((await ownerEntitlementForUser(userA))?.plan).toBe("growth");
    expect(await applySubscriptionEvent({ subscriptionId: "sub_unknown", plan: "growth", status: "active", renewsAt: null })).toBe(false);
  });

  it("password reset tokens work once, and only for the account they were made for", async () => {
    const email = (await dbForUser(userB).user.findUniqueOrThrow({ where: { id: userB } })).email;
    expect(await createPasswordReset("nobody@test.local", "h-none", new Date(Date.now() + 60_000))).toBeNull();
    expect(await createPasswordReset(email, `h-${userB}`, new Date(Date.now() + 60_000))).toMatchObject({ email });
    expect(await consumePasswordReset(`h-${userB}`)).toBe(userB);
    expect(await consumePasswordReset(`h-${userB}`)).toBeNull();
    await createPasswordReset(email, `h-old-${userB}`, new Date(Date.now() - 1));
    expect(await consumePasswordReset(`h-old-${userB}`)).toBeNull(); // expired
    expect(await basePrisma().passwordResetToken.findMany().catch((e: Error) => e.message)).toMatch(/permission denied/);
  });

  it("login lookup works without a context and returns only auth fields", async () => {
    const rows = await basePrisma().$queryRaw<{ email: string }[]>`SELECT email FROM users`;
    expect(rows).toEqual([]);
    const found = await findUserForLogin((await dbForUser(userA).user.findUniqueOrThrow({ where: { id: userA } })).email);
    expect(found?.id).toBe(userA);
  });
});
