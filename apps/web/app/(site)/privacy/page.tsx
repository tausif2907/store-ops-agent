import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Privacy policy", robots: { index: false } };

const SECTIONS: [string, string][] = [
  ["Who we are", "Who operates Store Ops Agent and how to reach us about privacy."],
  ["Information we collect", "Your account: name, email and a hashed password. Your store's connection details, encrypted. Your rules, automation settings and budget."],
  ["Store data the agent reads", "Orders, customers' names and contact details, products, coupons and reviews are read live from your store when the agent needs them, not copied wholesale. What a run reads and writes is kept in that run's trace, and drafts in your inbox."],
  ["How the AI processes it", "To answer questions and run automations, the relevant store data is sent to our AI model provider (Anthropic's Claude API). Your store's credentials are never sent to it."],
  ["Other services we use", "Hosting, the database and job queue, and email delivery for digests and approval links."],
  ["How long we keep it", "How long account data, run traces, drafts and the activity log are kept, and what happens when you disconnect a store or close your account."],
  ["Security", "Credentials encrypted with AES-256-GCM, each owner's data isolated in the database, and access limited to what the service needs."],
  ["Your choices and rights", "Seeing, correcting, exporting and deleting your data, and how to ask."],
  ["Changes to this policy", "How we will tell you when this policy changes."],
];

export default function PrivacyPage() {
  return <LegalPage title="Privacy policy" sections={SECTIONS} />;
}
