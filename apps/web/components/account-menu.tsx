import Link from "next/link";
import { logout } from "@/lib/auth-actions";
import { Icon } from "./site/icons";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

/** The signed-in owner's links: stores, account settings and log out. Opens without JavaScript. */
export function AccountMenu({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1 sm:gap-3">
      <Link href="/stores" className="hidden rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-ink sm:block">Stores</Link>
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100" aria-label="Account menu">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-green-600 to-teal-600 text-xs font-semibold text-white">
            {initials(name)}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium text-ink sm:block">{name}</span>
          <Icon name="chevronDown" className="h-4 w-4 text-slate-400" />
        </summary>
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <Link href="/stores" className="flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-emerald-50"><Icon name="bag" className="h-4 w-4 text-slate-500" />Your stores</Link>
          <Link href="/account" className="flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-emerald-50"><Icon name="sliders" className="h-4 w-4 text-slate-500" />Account and security</Link>
          <Link href="/account/billing" className="flex items-center gap-2 px-4 py-2 text-sm text-ink hover:bg-emerald-50"><Icon name="wallet" className="h-4 w-4 text-slate-500" />Plan and billing</Link>
          <form action={logout} className="border-t border-slate-100">
            <button className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-700 hover:bg-red-50"><Icon name="arrowRight" className="h-4 w-4" />Log out</button>
          </form>
        </div>
      </details>
    </div>
  );
}
