/**
 * Outgoing email through Resend's HTTP API. Without RESEND_API_KEY (local
 * development) messages are printed to the console instead of sent.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = (email: Email) => Promise<void>;
let transport: Transport | null = null;

/** Replaces how emails are sent (tests capture them). Pass null to restore. */
export function setEmailTransport(next: Transport | null): void {
  transport = next;
}

export async function sendEmail(email: Email): Promise<void> {
  if (transport) return transport(email);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Bodies hold one-time links (approvals, password resets): print them only
    // in development, never to a production log.
    if (process.env.NODE_ENV === "production") {
      console.warn(`Email not sent (RESEND_API_KEY is not set): "${email.subject}"`);
    } else {
      console.log(`[email not sent: RESEND_API_KEY unset]\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
    }
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Store Ops Agent <onboarding@resend.dev>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
