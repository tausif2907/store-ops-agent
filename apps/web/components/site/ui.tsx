import Link from "next/link";
import { Icon, type IconName } from "./icons";

/**
 * Building blocks for the public site, in its green, teal, white and black
 * palette: green-600 for actions and "done", teal-600 for "waiting" and
 * accents, ink (near-black) for text and dark bands.
 */

export function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-7xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
        dark ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-teal-100 bg-teal-50 text-teal-700"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dark ? "bg-green-400" : "bg-teal-600"}`} aria-hidden />
      {children}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, lead, center = false }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean }) {
  return (
    <div className={`max-w-3xl ${center ? "mx-auto text-center" : ""}`}>
      {eyebrow ? <div className="mb-3"><Eyebrow>{eyebrow}</Eyebrow></div> : null}
      <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h2>
      {lead ? <p className="mt-3 text-lg text-gray-500">{lead}</p> : null}
    </div>
  );
}

const BUTTON = {
  primary: "bg-green-600 text-white shadow-sm shadow-green-600/20 hover:-translate-y-0.5 hover:bg-green-700 hover:shadow-lg hover:shadow-green-600/25",
  outline: "border-2 border-ink bg-white text-ink hover:-translate-y-0.5 hover:bg-gray-50",
  light: "bg-white text-ink hover:-translate-y-0.5 hover:bg-gray-100",
  ghost: "border border-white/20 text-white hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/10",
} as const;

export function ButtonLink({ href, children, variant = "primary", size = "md", icon }: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof BUTTON;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
}) {
  const sizes = { sm: "px-3.5 py-2 text-sm", md: "px-5 py-2.5 text-sm", lg: "px-6 py-3.5 text-base" }[size];
  return (
    <Link href={href} className={`group inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition duration-200 ${sizes} ${BUTTON[variant]}`}>
      {children}
      {icon ? <Icon name={icon} className="h-4 w-4 transition-transform group-hover:translate-x-1" /> : null}
    </Link>
  );
}

/** A white card that lifts on hover; `still` keeps it in place (for forms). */
export function Card({ children, className = "", still = false }: { children: React.ReactNode; className?: string; still?: boolean }) {
  const lift = still ? "" : "transition duration-300 hover:-translate-y-1 hover:border-green-200 hover:shadow-xl hover:shadow-green-900/5";
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-6 shadow-sm ${lift} ${className}`}>
      {children}
    </div>
  );
}

export function IconTile({ name, tone = "green" }: { name: IconName; tone?: "green" | "teal" | "ink" }) {
  const tones = {
    green: "bg-gradient-to-br from-emerald-50 to-green-100 text-green-700 ring-green-600/10",
    teal: "bg-gradient-to-br from-teal-50 to-cyan-100 text-teal-700 ring-teal-600/10",
    ink: "bg-gray-100 text-ink ring-gray-900/5",
  }[tone];
  return (
    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${tones}`}>
      <Icon name={name} />
    </span>
  );
}

/** A small monospace chip, used for schedules and technical labels. */
export function Chip({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "green" | "ink" | "gray" }) {
  const tones = {
    teal: "border-teal-100 bg-teal-50 text-teal-700",
    green: "border-green-100 bg-emerald-50 text-green-700",
    ink: "border-ink bg-ink text-white",
    gray: "border-gray-200 bg-gray-50 text-gray-600",
  }[tone];
  return <span className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] font-medium ${tones}`}>{children}</span>;
}

export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: React.ReactNode; lead: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-gray-200 bg-gradient-to-b from-emerald-50/80 to-white">
      <div className="site-grid-light pointer-events-none absolute inset-0" aria-hidden />
      <div className="site-drift pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-green-300/25 blur-3xl" aria-hidden />
      <Container className="relative py-16 text-center lg:py-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-500">{lead}</p>
        {children}
      </Container>
    </section>
  );
}

export function CtaBand({ title = "See what your store did yesterday.", lead = "Connect it and your first digest is on its way. About five minutes, no card." }: { title?: string; lead?: string }) {
  return (
    <section className="relative overflow-hidden bg-ink">
      <div className="site-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="site-drift pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_120%,rgba(22,163,74,0.4),rgba(13,148,136,0.18)_45%,transparent_70%)]" aria-hidden />
      <Container className="relative flex flex-col items-center gap-5 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
        <p className="max-w-xl text-gray-300">{lead}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/signup" size="lg" icon="arrowRight">Get started</ButtonLink>
          <ButtonLink href="/features" size="lg" variant="ghost">See every feature</ButtonLink>
        </div>
      </Container>
    </section>
  );
}

export function Check({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "ink" }) {
  return (
    <li className="flex gap-2.5">
      <Icon name={tone === "green" ? "check" : "x"} className={`mt-0.5 h-4 w-4 shrink-0 ${tone === "green" ? "text-green-600" : "text-ink"}`} />
      <span>{children}</span>
    </li>
  );
}
