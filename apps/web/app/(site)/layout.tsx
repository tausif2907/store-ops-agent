import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { getSessionUser } from "@/lib/session";

/** The public website: home, features, safety, integrations, pricing, developers, FAQ, about, contact and legal pages. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="flex min-h-screen flex-col bg-white text-ink antialiased">
      <SiteHeader signedIn={user !== null} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
