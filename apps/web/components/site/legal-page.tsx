import { CONTACT_EMAIL } from "@/lib/site";
import { Icon } from "./icons";
import { Container, Eyebrow } from "./ui";

/**
 * A legal page awaiting its real text: the sections it must have, each with
 * an accurate note of what the service actually does there, under a banner
 * that says it is a draft.
 */
export function LegalPage({ title, sections }: { title: string; sections: [string, string][] }) {
  const id = (heading: string) => heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return (
    <section className="bg-gray-50">
      <Container className="py-16">
        <Eyebrow>Legal</Eyebrow>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink">{title}</h1>
        <div className="mt-6 flex gap-3 rounded-[10px] border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900" role="note">
          <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
          <p>
            <strong>Draft: legal text to be added before launch.</strong> This page lists what the final {title.toLowerCase()} will cover and how the
            service works today. It is not yet a binding document. Questions: <a className="font-medium underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-4">
          <nav className="h-fit rounded-[10px] border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-24" aria-label="Contents">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contents</p>
            <ol className="mt-3 space-y-2 text-sm">
              {sections.map(([heading], i) => (
                <li key={heading}>
                  <a href={`#${id(heading)}`} className="text-gray-700 hover:text-green-700">
                    <span className="mr-2 font-mono text-xs text-gray-400">{String(i + 1).padStart(2, "0")}</span>
                    {heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="space-y-4 lg:col-span-3">
            {sections.map(([heading, note], i) => (
              <article key={heading} id={id(heading)} className="scroll-mt-24 rounded-[10px] border border-gray-200 bg-white p-6 shadow-sm">
                <p className="font-mono text-xs font-semibold text-teal-700">Section {String(i + 1).padStart(2, "0")}</p>
                <h2 className="mt-1 text-lg font-semibold text-ink">{heading}</h2>
                <p className="mt-3 text-sm leading-relaxed text-gray-600">{note}</p>
                <p className="mt-3 text-xs italic text-gray-400">Legal text to be added.</p>
              </article>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
