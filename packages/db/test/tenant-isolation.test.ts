import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basePrisma, createUser, dbForStore, dbForUser, findUserForLogin } from "../src/index";

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

  it("login lookup works without a context and returns only auth fields", async () => {
    const rows = await basePrisma().$queryRaw<{ email: string }[]>`SELECT email FROM users`;
    expect(rows).toEqual([]);
    const found = await findUserForLogin((await dbForUser(userA).user.findUniqueOrThrow({ where: { id: userA } })).email);
    expect(found?.id).toBe(userA);
  });
});
