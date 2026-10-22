"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE_NAV } from "@/lib/site";
import { Icon } from "./icons";

export function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="text-lg font-bold tracking-tight">
      <span className={dark ? "text-white" : "text-ink"}>Store Ops</span> <span className={dark ? "text-green-400" : "text-green-600"}>Agent</span>
    </span>
  );
}

/** The public site's header. Signed-in owners get a link back to their dashboard instead of the sign-up buttons. */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const actions = signedIn ? (
    <Link href="/stores" className="rounded-[10px] bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700">
      Go to dashboard
    </Link>
  ) : (
    <>
      <Link href="/login" className="text-sm text-ink hover:text-green-700">Log in</Link>
      <Link href="/signup" className="rounded-[10px] bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700">
        Get started
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Store Ops Agent home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Site">
          {SITE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`text-sm transition-colors ${pathname === item.href ? "font-semibold text-green-700" : "text-gray-600 hover:text-ink"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-4 sm:flex">{actions}</div>

        {/* Small screens: a menu that needs no JavaScript to open. */}
        <details className="group relative sm:hidden lg:hidden">
          <summary className="flex cursor-pointer list-none items-center rounded-md p-2 text-ink hover:bg-gray-100" aria-label="Menu">
            <Icon name="menu" />
          </summary>
          <div className="absolute right-0 mt-2 w-60 rounded-[10px] border border-gray-200 bg-white p-2 shadow-lg">
            {SITE_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-emerald-50">
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 px-1 pt-3">{actions}</div>
          </div>
        </details>
      </div>
      <nav className="no-scrollbar hidden gap-5 overflow-x-auto border-t border-gray-100 px-4 py-2 sm:flex lg:hidden" aria-label="Site sections">
        {SITE_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={`whitespace-nowrap text-sm ${pathname === item.href ? "font-semibold text-green-700" : "text-gray-600"}`}>
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
