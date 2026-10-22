"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/site/icons";

const TABS: { path: string; label: string; icon: IconName; exact?: boolean; badge?: "approvals" | "drafts" }[] = [
  { path: "", label: "Overview", icon: "chart", exact: true },
  { path: "/chat", label: "Ask the agent", icon: "chat" },
  { path: "/approvals", label: "Approvals", icon: "checkCircle", badge: "approvals" },
  { path: "/inbox", label: "Inbox", icon: "inbox", badge: "drafts" },
  { path: "/automations", label: "Automations", icon: "clock" },
  { path: "/policies", label: "Rules", icon: "sliders" },
  { path: "/activity", label: "Activity", icon: "log" },
  { path: "/runs", label: "Runs", icon: "bolt" },
];

export function StoreTabs({ storeId, pendingApprovals, pendingDrafts }: { storeId: string; pendingApprovals: number; pendingDrafts: number }) {
  const pathname = usePathname();
  const base = `/stores/${storeId}`;
  const counts = { approvals: pendingApprovals, drafts: pendingDrafts };
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Store sections">
      {TABS.map((t) => {
        const href = `${base}${t.path}`;
        const active = t.exact ? pathname === href || pathname === `${base}/welcome` : pathname.startsWith(href);
        const count = t.badge ? counts[t.badge] : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
              active ? "bg-green-600 font-semibold text-white shadow-sm" : "text-slate-600 hover:bg-emerald-50 hover:text-green-800"
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
            {count ? (
              <span className={`rounded-full px-1.5 text-xs font-semibold ${active ? "bg-white text-green-700" : "bg-teal-600 text-white"}`}>{count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
