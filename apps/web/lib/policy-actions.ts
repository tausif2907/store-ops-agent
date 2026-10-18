"use server";

import { revalidatePath } from "next/cache";
import { dbForUser, type Prisma } from "@store-ops/db";
import { ORDER_STATUSES } from "@store-ops/shared";
import { TOOLS, decideApproval, parsePolicySetting, toJson, verifyApprovalLink, type DecisionResult, type StorePolicy } from "@store-ops/tools";
import { requireUser } from "./session";

async function ownedStore(storeId: string) {
  const user = await requireUser();
  const store = await dbForUser(user.id).store.findUnique({ where: { id: storeId }, select: { id: true, isPaused: true } });
  if (!store) throw new Error("Store not found");
  return { user, store, db: dbForUser(user.id) };
}

/** The kill switch: pausing stops every agent run and every change. */
export async function setPaused(storeId: string, paused: boolean): Promise<void> {
  const { user, db } = await ownedStore(storeId);
  await db.store.update({ where: { id: storeId }, data: { isPaused: paused } });
  await db.auditLog.create({ data: { storeId, actor: `user:${user.id}`, action: paused ? "store.paused" : "store.resumed" } });
  revalidatePath(`/stores/${storeId}`, "layout");
}

export interface PolicyFormState {
  error?: string;
  saved?: boolean;
}

function readNumber(form: FormData, key: string): number | undefined {
  const raw = String(form.get(key) ?? "").trim();
  return raw === "" ? undefined : Number(raw);
}

/** Saves every tool's mode and limits from the settings form. */
export async function savePolicies(storeId: string, _prev: PolicyFormState, form: FormData): Promise<PolicyFormState> {
  const { user, db } = await ownedStore(storeId);
  const settings: Record<string, StorePolicy & { limits: Record<string, unknown> }> = {};

  for (const tool of TOOLS) {
    const limits: Record<string, unknown> = {};
    for (const key of ["maxPercent", "maxFixedAmount", "maxUsageLimit", "maxChange", "maxPerDay"]) {
      const value = readNumber(form, `${tool.name}.${key}`);
      if (value !== undefined) limits[key] = key === "maxFixedAmount" ? Math.round(value * 100) : value; // rupees → paise
    }
    if (tool.name === "update_order_status") {
      const statuses = form.getAll(`${tool.name}.allowedStatuses`).map(String).filter((s) => (ORDER_STATUSES as readonly string[]).includes(s));
      if (form.get(`${tool.name}.restrictStatuses`) === "on") limits.allowedStatuses = statuses;
    }
    const parsed = parsePolicySetting(tool, { mode: String(form.get(`${tool.name}.mode`) ?? tool.defaultMode), limits });
    if (!parsed.ok) return { error: parsed.error };
    settings[tool.name] = parsed.value;
  }

  const before = await db.policy.findMany({ where: { storeId }, select: { action: true, mode: true, limits: true } });
  for (const [action, value] of Object.entries(settings)) {
    await db.policy.upsert({
      where: { storeId_action: { storeId, action } },
      create: { storeId, action, mode: value.mode, limits: value.limits as Prisma.InputJsonValue },
      update: { mode: value.mode, limits: value.limits as Prisma.InputJsonValue },
    });
  }
  await db.auditLog.create({
    data: {
      storeId,
      actor: `user:${user.id}`,
      action: "policies.updated",
      before: toJson(Object.fromEntries(before.map((p) => [p.action, { mode: p.mode, limits: p.limits }]))),
      after: toJson(settings),
    },
  });
  revalidatePath(`/stores/${storeId}`, "layout");
  return { saved: true };
}

/** Approve or reject from the dashboard. */
export async function decideFromDashboard(storeId: string, approvalId: string, decision: "APPROVE" | "REJECT"): Promise<DecisionResult> {
  const { user } = await ownedStore(storeId);
  const result = await decideApproval({ storeId, approvalId, decision, userId: user.id, via: "dashboard" });
  revalidatePath(`/stores/${storeId}`, "layout");
  return result;
}

/** Approve or reject from an email link; the signed token stands in for a sign-in. */
export async function decideFromLink(token: string, decision: "APPROVE" | "REJECT"): Promise<DecisionResult> {
  const claims = await verifyApprovalLink(token);
  if (!claims) return { ok: false, status: "INVALID_LINK", message: "This link is invalid or has expired." };
  return decideApproval({ storeId: claims.storeId, approvalId: claims.approvalId, decision, userId: claims.ownerId, via: "email" });
}
