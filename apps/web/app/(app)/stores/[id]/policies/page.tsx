import { dbForUser } from "@store-ops/db";
import { TOOLS, allowedModes, effectiveMode } from "@store-ops/tools";
import { savePolicies } from "@/lib/policy-actions";
import { requireUser } from "@/lib/session";
import { PolicyForm, type ToolRow } from "./policy-form";

export default async function PoliciesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = dbForUser(user.id);
  const store = await db.store.findUniqueOrThrow({ where: { id }, select: { id: true, currency: true, policies: true } });
  const saved = new Map(store.policies.map((p) => [p.action, p]));

  const rows: ToolRow[] = TOOLS.map((t) => {
    const policy = saved.get(t.name);
    return {
      name: t.name,
      description: t.description,
      type: t.type,
      modes: allowedModes(t),
      mode: effectiveMode(t, policy ? { mode: policy.mode, limits: policy.limits } : undefined),
      limits: (policy?.limits ?? {}) as Record<string, unknown>,
    };
  });

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600">
        <p>Decide what the agent may do on its own. Every change is checked against these rules in code, whatever the agent was told.</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          <li><strong>Automatic</strong> — runs right away and is logged. Limits are optional; a change over a limit is sent to you for approval instead.</li>
          <li><strong>Ask me</strong> — saved for your approval in the dashboard and by email. Expires after 30 minutes.</li>
          <li><strong>Off</strong> — the agent cannot see or use it.</li>
        </ul>
      </div>
      <PolicyForm rows={rows} currency={store.currency} action={savePolicies.bind(null, store.id)} />
    </div>
  );
}
