import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal-page";

export const metadata: Metadata = { title: "Terms of service", robots: { index: false } };

const SECTIONS: [string, string][] = [
  ["The service", "What Store Ops Agent does: answers questions about your store, runs scheduled automations, drafts messages, and makes changes your rules allow or you approve."],
  ["Your account", "Who may sign up, keeping your login safe, and connecting only stores you are allowed to connect."],
  ["Your rules and approvals", "You decide which actions run automatically and within which limits, and you approve the rest. You are responsible for the rules you set and the changes you approve."],
  ["What the agent does not do", "It cannot refund, change prices, delete anything or message your customers. Drafts are sent by you."],
  ["Plans, trial and AI usage", "The free trial, plan prices, included AI usage, the monthly limit, and how changes to plans work."],
  ["Acceptable use", "Not using the service to break the law, spam customers, or overload the platforms you connect."],
  ["Your data", "Your store's data remains yours. What we may do with it is set out in the privacy policy."],
  ["Availability", "How we run the service, planned maintenance, and the pause switch you can use at any time."],
  ["Ending the service", "Disconnecting a store, closing your account, and what happens to your data."],
  ["Liability", "The limits of our responsibility for actions taken under your rules or with your approval."],
  ["Governing law", "Which law applies and where disputes are resolved."],
];

export default function TermsPage() {
  return <LegalPage title="Terms of service" sections={SECTIONS} />;
}
