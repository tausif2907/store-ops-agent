const STYLES: Record<string, string> = {
  RUNNING: "bg-blue-50 text-blue-700",
  SUCCEEDED: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-700",
  WAITING_APPROVAL: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  // Tool-call policy decisions
  AUTO: "bg-emerald-50 text-emerald-700",
  ASK: "bg-amber-50 text-amber-700",
  NEVER: "bg-slate-100 text-slate-600",
  PAUSED: "bg-slate-100 text-slate-600",
  ERROR: "bg-red-50 text-red-700",
  INVALID_INPUT: "bg-red-50 text-red-700",
  UNKNOWN_TOOL: "bg-red-50 text-red-700",
};

export function RunStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
