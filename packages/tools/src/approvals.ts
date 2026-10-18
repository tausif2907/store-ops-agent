import { createAdapter, isAdapterError, type StoreAdapter } from "@store-ops/adapters";
import { dbForStore, storeOwnerContact, type Prisma } from "@store-ops/db";
import { decryptJson } from "@store-ops/shared/crypto";
import { approvalUrl, signApprovalLink } from "./approval-link";
import { ToolInputError, getTool, type ToolContext, type ToolDefinition } from "./catalog";
import { escapeHtml, sendEmail } from "./email";

export const APPROVAL_TTL_MS = 30 * 60 * 1000;

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Turns a failed tool run into a message safe to show the model or the owner. */
export function describeToolError(err: unknown): string {
  if (err instanceof ToolInputError) return err.message;
  if (isAdapterError(err)) return `${err.code}: ${err.message}`;
  return "The store could not complete this request.";
}

/** Builds the adapter for a store, runs `fn`, and always closes it. */
export async function withStoreAdapter<T>(
  storeId: string,
  fn: (adapter: StoreAdapter, store: ToolContext["store"] & { isPaused: boolean }) => Promise<T>,
): Promise<T> {
  const store = await dbForStore(storeId).store.findUnique({ where: { id: storeId }, include: { connection: true } });
  if (!store?.connection || store.connection.status !== "ACTIVE") throw new ToolInputError("The store is not connected.");
  const adapter = createAdapter(store.platform, decryptJson(store.connection.credentialsEncrypted));
  try {
    return await fn(adapter, { id: store.id, name: store.name, currency: store.currency, timezone: store.timezone, isPaused: store.isPaused });
  } finally {
    await adapter.close();
  }
}

/**
 * Saves a call for the owner's approval and emails them a one-time link.
 * Email failures are logged, never thrown: the approval is in the dashboard either way.
 */
export async function requestApproval(args: {
  storeId: string;
  toolCallId: string;
  tool: ToolDefinition;
  input: Record<string, unknown>;
  reason: string | null;
}) {
  const db = dbForStore(args.storeId);
  const approval = await db.approval.create({
    data: {
      toolCallId: args.toolCallId,
      args: toJson(args.input),
      summary: args.tool.summarize(args.input as never),
      reason: args.reason,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });
  try {
    await emailApproval(args.storeId, approval);
  } catch (err) {
    console.error(`Could not email approval ${approval.id}`, err);
  }
  return approval;
}

async function emailApproval(storeId: string, approval: { id: string; summary: string; reason: string | null; expiresAt: Date }) {
  const [owner, ownerRow] = await Promise.all([
    storeOwnerContact(storeId),
    dbForStore(storeId).store.findUnique({ where: { id: storeId }, select: { ownerId: true, name: true, timezone: true } }),
  ]);
  if (!owner || !ownerRow) return;
  const token = await signApprovalLink({ approvalId: approval.id, storeId, ownerId: ownerRow.ownerId }, approval.expiresAt);
  const link = approvalUrl(token);
  const expires = new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: ownerRow.timezone }).format(approval.expiresAt);
  const reason = approval.reason ? `\n${approval.reason}\n` : "";
  await sendEmail({
    to: owner.email,
    subject: `Approve? ${approval.summary}`,
    text: `Hi ${owner.name},\n\nThe agent wants to make a change to ${ownerRow.name}:\n\n  ${approval.summary}\n${reason}\nReview it here (link expires at ${expires}):\n${link}\n\nNothing happens unless you approve.`,
    html: `<p>Hi ${escapeHtml(owner.name)},</p>
<p>The agent wants to make a change to <strong>${escapeHtml(ownerRow.name)}</strong>:</p>
<p style="padding:12px;background:#f1f5f9;border-radius:6px">${escapeHtml(approval.summary)}</p>
${approval.reason ? `<p style="color:#92400e">${escapeHtml(approval.reason)}</p>` : ""}
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Review the change</a></p>
<p style="color:#64748b;font-size:13px">The link expires at ${escapeHtml(expires)}. Nothing happens unless you approve.</p>`,
  });
}

/** Marks a store's overdue pending approvals as expired. */
export async function expireStaleApprovals(storeId: string): Promise<number> {
  const { count } = await dbForStore(storeId).approval.updateMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() }, toolCall: { run: { storeId } } },
    data: { status: "EXPIRED" },
  });
  return count;
}

export type DecisionResult =
  | { ok: true; status: "EXECUTED" | "REJECTED"; message: string }
  | { ok: false; status: string; message: string };

/**
 * The owner approves or rejects a pending call. Approving runs the exact saved
 * arguments (the owner's decision overrides Auto limits). Each approval leaves
 * PENDING at most once, so a double click or a reused email link does nothing.
 */
export async function decideApproval(args: {
  storeId: string;
  approvalId: string;
  decision: "APPROVE" | "REJECT";
  userId: string;
  via: "dashboard" | "email";
}): Promise<DecisionResult> {
  const { storeId, approvalId, userId, via } = args;
  const db = dbForStore(storeId);
  await expireStaleApprovals(storeId);

  const approval = await db.approval.findFirst({
    where: { id: approvalId, toolCall: { run: { storeId } } },
    include: { toolCall: { select: { toolName: true } } },
  });
  if (!approval) return { ok: false, status: "NOT_FOUND", message: "This approval does not exist." };
  if (approval.status !== "PENDING") {
    return { ok: false, status: approval.status, message: `This change was already ${approval.status.toLowerCase()}.` };
  }

  const actor = `user:${userId}`;
  if (args.decision === "REJECT") {
    const { count } = await db.approval.updateMany({
      where: { id: approvalId, status: "PENDING" },
      data: { status: "REJECTED", decidedBy: userId, decidedAt: new Date() },
    });
    if (count === 0) return { ok: false, status: "CHANGED", message: "This approval was decided a moment ago." };
    await db.auditLog.create({
      data: { storeId, actor, action: "approval.rejected", after: toJson({ approvalId, summary: approval.summary, via }) },
    });
    return { ok: true, status: "REJECTED", message: "Rejected. Nothing was changed." };
  }

  const store = await db.store.findUnique({ where: { id: storeId }, select: { isPaused: true } });
  if (store?.isPaused) return { ok: false, status: "PAUSED", message: "The store is paused. Resume it before approving changes." };

  const def = getTool(approval.toolCall.toolName);
  const input = def?.input.safeParse(approval.args);
  if (!def || !input?.success) {
    await db.approval.update({ where: { id: approvalId }, data: { status: "FAILED", error: "The saved arguments are no longer valid." } });
    return { ok: false, status: "FAILED", message: "The saved change is no longer valid." };
  }

  // Claim it first, so two clicks cannot run the change twice.
  const { count } = await db.approval.updateMany({
    where: { id: approvalId, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "APPROVED", decidedBy: userId, decidedAt: new Date() },
  });
  if (count === 0) return { ok: false, status: "CHANGED", message: "This approval expired or was decided a moment ago." };

  try {
    const result = await withStoreAdapter(storeId, (adapter, s) => def.run(input.data, { adapter, store: s }));
    await db.approval.update({ where: { id: approvalId }, data: { status: "EXECUTED", result: toJson(result) } });
    await db.auditLog.create({
      data: {
        storeId,
        actor,
        action: def.name,
        before: toJson({ approvalId, input: input.data, via }),
        after: toJson(result),
      },
    });
    return { ok: true, status: "EXECUTED", message: `Done: ${approval.summary}.` };
  } catch (err) {
    const message = describeToolError(err);
    await db.approval.update({ where: { id: approvalId }, data: { status: "FAILED", error: message } });
    await db.auditLog.create({
      data: { storeId, actor, action: `${def.name}.failed`, before: toJson({ approvalId, input: input.data, via }), after: toJson({ error: message }) },
    });
    return { ok: false, status: "FAILED", message: `Approved, but the store refused it: ${message}` };
  }
}
