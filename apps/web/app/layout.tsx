import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/lib/auth-actions";
import { getSessionUser } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Store Ops Agent",
  description: "An AI agent that runs day-to-day store operations within rules you set.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href={user ? "/stores" : "/"} className="font-semibold tracking-tight">
              Store Ops <span className="text-brand">Agent</span>
            </Link>
            {user ? (
              <form action={logout} className="flex items-center gap-3 text-sm">
                <span className="text-slate-500">{user.name}</span>
                <button className="text-slate-600 hover:text-slate-900">Log out</button>
              </form>
            ) : (
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/login" className="text-slate-600 hover:text-slate-900">Log in</Link>
                <Link href="/signup" className="btn btn-sm">Get started</Link>
              </nav>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
