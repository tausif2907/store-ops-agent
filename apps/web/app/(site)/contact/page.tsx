import type { Metadata } from "next";
import { Icon } from "@/components/site/icons";
import { ButtonLink, Card, Container, Eyebrow } from "@/components/site/ui";
import { CONTACT_EMAIL } from "@/lib/site";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions, a custom store, or help connecting? Write to us.",
};

export default function ContactPage() {
  return (
    <>
      <section className="bg-gray-50">
        <Container className="py-16 lg:py-20">
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">Talk to us.</h1>
          <p className="mt-3 max-w-2xl text-lg text-gray-500">Questions, a custom store, or help connecting? We reply within one working day.</p>

          <div className="mt-10 grid gap-6 lg:grid-cols-5">
            <Card still className="lg:col-span-3">
              <h2 className="mb-5 font-semibold text-ink">Send us a message</h2>
              <ContactForm />
            </Card>

            <div className="space-y-4 lg:col-span-2">
              <Card className="bg-teal-50/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Email</p>
                <a href={`mailto:${CONTACT_EMAIL}`} className="mt-2 flex items-center gap-2 break-all font-semibold text-ink hover:text-green-700">
                  <Icon name="mail" className="h-5 w-5 shrink-0 text-teal-700" />
                  {CONTACT_EMAIL}
                </a>
              </Card>
              <Card>
                <p className="flex items-center gap-2 font-semibold text-ink"><Icon name="info" className="h-4 w-4 text-teal-700" />Need help connecting?</p>
                <p className="mt-1.5 text-sm text-gray-600">Tell us your platform (Shopify, WooCommerce, Supabase or custom) and what you see when you try.</p>
              </Card>
              <Card>
                <p className="flex items-center gap-2 font-semibold text-ink"><Icon name="terminal" className="h-4 w-4 text-teal-700" />Building a custom store?</p>
                <p className="mt-1.5 text-sm text-gray-600">Tell us about your backend, and we&apos;ll help you implement the connector API.</p>
              </Card>
            </div>
          </div>
        </Container>
      </section>

      <section className="border-t border-gray-200 bg-white">
        <Container className="flex flex-col gap-5 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold text-ink">Prefer to just try it?</p>
            <p className="text-sm text-gray-500">Connect your store; we test the connection before saving anything.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/developers" variant="outline">Connector API</ButtonLink>
            <ButtonLink href="/signup" icon="arrowRight">Get started</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
