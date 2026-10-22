import Link from "next/link";
import { CONNECTOR_SPEC_URL, CONTACT_EMAIL } from "@/lib/site";
import { Wordmark } from "./header";

const COLUMNS = [
  { title: "Product", links: [["Features", "/features"], ["Safety", "/safety"], ["Integrations", "/integrations"], ["Pricing", "/pricing"], ["FAQ", "/faq"]] },
  { title: "Developers", links: [["Connector API", "/developers"], ["OpenAPI spec", CONNECTOR_SPEC_URL]] },
  { title: "Company", links: [["About", "/about"], ["Contact", "/contact"]] },
  { title: "Legal", links: [["Privacy", "/privacy"], ["Terms", "/terms"]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="bg-[#1b1f1e] text-gray-300">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <Wordmark dark />
            <p className="mt-3 text-sm text-gray-400">An AI for your store&apos;s day-to-day, within rules you set.</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wider text-white">{col.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="hover:text-white">{label}</Link>
                  </li>
                ))}
              </ul>
              {col.title === "Company" ? (
                <div className="mt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Email us</p>
                  <a href={`mailto:${CONTACT_EMAIL}`} className="mt-1 block break-all text-sm text-green-400 hover:text-green-300">{CONTACT_EMAIL}</a>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-gray-500 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Store Ops Agent. All rights reserved.</p>
          <p>Every change is checked against your rules, in code.</p>
        </div>
      </div>
    </footer>
  );
}
