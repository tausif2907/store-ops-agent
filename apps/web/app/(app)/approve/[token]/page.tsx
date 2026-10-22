import { dbForStore } from "@store-ops/db";
import { expireStaleApprovals, verifyApprovalLink } from "@store-ops/tools";
import { DecisionButtons } from "@/components/decision-buttons";
import { formatDateTime } from "@/lib/format";
import { decideFromLink } from "@/lib/policy-actions";

/**
 * The page an approval email links to. The signed link stands in for a
 * sign-in, so the owner can decide from their phone. Opening it changes
 * nothing; only pressing a button does (link scanners only open pages).
 */
export default async function ApproveByLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claims = await verifyApprovalLink(token);
  if (!claims) return <Message title="This link has expired" body="Approval links work for 30 minutes. You can still review changes in the dashboard." />;

  await expireStaleApprovals(claims.storeId);
  const db = dbForStore(claims.storeId);
  const [store, approval] = await Promise.all([
    db.store.findUnique({ where: { id: claims.storeId }, select: { name: true, timezone: true, isPaused: true } }),
    db.approval.findFirst({ where: { id: claims.approvalId, toolCall: { run: { storeId: claims.storeId } } } }),
  ]);
  if (!store || !approval) return <Message title="Change not found" body="It may have been removed." />;

  return (
    <div className="mx-auto mt-10 max-w-lg space-y-4">
      <p className="text-sm text-slate-500">{store.name}</p>
      <h1 className="text-2xl font-semibold">Approve this change?</h1>
      <div className="card space-y-3">
        <p className="font-medium">{approval.summary}</p>
        {approval.reason ? <p className="text-sm text-teal-700">{approval.reason}</p> : null}
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">Exact change</summary>
          <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(approval.args, null, 2)}</pre>
        </details>
        {approval.status === "PENDING" ? (
          store.isPaused ? (
            <p className="text-sm text-teal-700">The store is paused. Resume it in the dashboard before approving.</p>
          ) : (
            <>
              <p className="text-xs text-slate-500">Expires {formatDateTime(approval.expiresAt.toISOString(), store.timezone)}.</p>
              <DecisionButtons decide={decideFromLink.bind(null, token)} />
            </>
          )
        ) : (
          <p className="text-sm text-slate-600">This change was already {approval.status.toLowerCase()}.</p>
        )}
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}
