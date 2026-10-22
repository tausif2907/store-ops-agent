"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbForUser, type Prisma } from "@store-ops/db";
import {
  JOBS,
  JOB_TYPES,
  adapterForStore,
  describeToolError,
  enqueueJobNow,
  ensureDefaultJobs,
  isValidSchedule,
  startFirstDigest,
  toJson,
  type JobType,
} from "@store-ops/tools";
import { requireUser } from "./session";

async function ownedStore(storeId: string) {
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUnique({ where: { id: storeId }, include: { connection: true } });
  if (!store) throw new Error("Store not found");
  return { user, db, store };
}

export interface AutomationFormState {
  error?: string;
  saved?: boolean;
}

/** Saves every job's on/off switch, schedule and settings. */
export async function saveAutomations(storeId: string, _prev: AutomationFormState, form: FormData): Promise<AutomationFormState> {
  const { user, db } = await ownedStore(storeId);
  await ensureDefaultJobs(db, storeId);
  const changes: Record<string, unknown> = {};
  for (const type of JOB_TYPES) {
    const schedule = String(form.get(`${type}.schedule`) ?? "").trim();
    if (!isValidSchedule(schedule)) return { error: `${JOBS[type].title}: that schedule is not one we support.` };
    const config: Record<string, unknown> = {};
    if (type === "low_stock_watch") {
      const threshold = Number(form.get(`${type}.threshold`));
      const parsed = z.number().int().min(0).max(1000).safeParse(threshold);
      if (!parsed.success) return { error: "Low-stock watch: the threshold must be a whole number from 0 to 1000." };
      config.threshold = parsed.data;
    }
    const isEnabled = form.get(`${type}.enabled`) === "on";
    await db.job.update({
      where: { storeId_type: { storeId, type } },
      data: { schedule, isEnabled, config: config as Prisma.InputJsonValue },
    });
    changes[type] = { isEnabled, schedule, config };
  }
  await db.auditLog.create({ data: { storeId, actor: `user:${user.id}`, action: "automations.updated", after: toJson(changes) } });
  revalidatePath(`/stores/${storeId}`, "layout");
  return { saved: true };
}

/** Starts a job now, whatever its schedule. */
export async function runJobNow(storeId: string, type: JobType): Promise<{ ok: boolean; message: string }> {
  const { store } = await ownedStore(storeId);
  if (store.isPaused) return { ok: false, message: "The store is paused." };
  try {
    await enqueueJobNow(storeId, parseJobType(type), "manual");
  } catch {
    return { ok: false, message: "The job worker is not reachable." };
  }
  return { ok: true, message: "Started. Results appear on the overview and in Runs in a minute or two." };
}

/** Starts (or restarts) a store's first digest from the welcome page. */
export async function startWelcomeDigest(storeId: string): Promise<{ jobId: string } | { error: string }> {
  const { store } = await ownedStore(storeId);
  if (store.isPaused) return { error: "The store is paused. Resume it first." };
  const jobId = await startFirstDigest(storeId);
  return jobId ? { jobId } : { error: "The job queue cannot be reached right now. Try again in a minute." };
}

function parseJobType(type: string): JobType {
  if (!(JOB_TYPES as readonly string[]).includes(type)) throw new Error("Unknown job");
  return type as JobType;
}

// ---- Inbox ----------------------------------------------------------------------

export type DraftDecision = "SEND" | "POST" | "DISMISS";

/**
 * The owner acts on a draft. Customer messages are sent by the owner
 * themselves (the agent never emails customers), so SEND just records it.
 * POST publishes a review reply through the store, as the owner.
 */
export async function decideDraft(storeId: string, draftId: string, decision: DraftDecision, body: string): Promise<{ ok: boolean; message: string }> {
  const { user, db, store } = await ownedStore(storeId);
  const draft = await db.draft.findFirst({ where: { id: draftId, storeId } });
  if (!draft) return { ok: false, message: "This draft no longer exists." };
  if (draft.status !== "PENDING") return { ok: false, message: `Already ${draft.status.toLowerCase()}.` };
  const text = body.trim().slice(0, 2000) || draft.body;
  const actor = `user:${user.id}`;

  if (decision === "DISMISS") {
    await db.draft.update({ where: { id: draftId }, data: { status: "DISMISSED", body: text, decidedBy: user.id, decidedAt: new Date() } });
    revalidatePath(`/stores/${storeId}`, "layout");
    return { ok: true, message: "Dismissed." };
  }

  if (decision === "SEND") {
    if (draft.kind !== "CUSTOMER_MESSAGE") return { ok: false, message: "Only customer messages can be marked as sent." };
    await db.draft.update({ where: { id: draftId }, data: { status: "SENT", body: text, decidedBy: user.id, decidedAt: new Date() } });
    await db.auditLog.create({ data: { storeId, actor, action: "draft.sent", after: toJson({ draftId, to: draft.recipient, target: draft.targetLabel }) } });
    revalidatePath(`/stores/${storeId}`, "layout");
    return { ok: true, message: "Marked as sent." };
  }

  // POST a review reply
  if (draft.kind !== "REVIEW_REPLY") return { ok: false, message: "Only review replies can be posted." };
  if (store.isPaused) return { ok: false, message: "The store is paused. Resume it before posting." };
  if (!store.connection) return { ok: false, message: "The store is not connected." };
  const claimed = await db.draft.updateMany({ where: { id: draftId, status: "PENDING" }, data: { status: "POSTED", body: text, decidedBy: user.id, decidedAt: new Date() } });
  if (claimed.count === 0) return { ok: false, message: "This draft was handled a moment ago." };
  const adapter = adapterForStore(store, store.connection.credentialsEncrypted);
  try {
    const review = await adapter.replyToReview(draft.targetId, text);
    await db.auditLog.create({ data: { storeId, actor, action: "reply_to_review", before: toJson({ draftId, via: "inbox" }), after: toJson(review) } });
    revalidatePath(`/stores/${storeId}`, "layout");
    return { ok: true, message: "Reply posted." };
  } catch (err) {
    await db.draft.update({ where: { id: draftId }, data: { status: "PENDING", decidedBy: null, decidedAt: null } });
    return { ok: false, message: `The store refused it: ${describeToolError(err)}` };
  } finally {
    await adapter.close();
  }
}

/** Sets the store's monthly agent budget in rupees; empty restores the default. */
export async function setBudget(storeId: string, _prev: AutomationFormState, form: FormData): Promise<AutomationFormState> {
  const { user, db, store } = await ownedStore(storeId);
  const raw = String(form.get("budget") ?? "").trim();
  const value = raw === "" ? null : Number(raw);
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) {
    return { error: "Enter an amount in rupees, from 0 to 10,00,000." };
  }
  await db.store.update({ where: { id: storeId }, data: { monthlyBudgetInr: value === null ? null : Math.round(value * 100) / 100 } });
  await db.auditLog.create({
    data: { storeId, actor: `user:${user.id}`, action: "budget.updated", before: toJson({ monthlyBudgetInr: store.monthlyBudgetInr }), after: toJson({ monthlyBudgetInr: value }) },
  });
  revalidatePath(`/stores/${storeId}`, "layout");
  return { saved: true };
}
