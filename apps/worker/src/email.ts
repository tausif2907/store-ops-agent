import { Marked } from "marked";
import { storeOwnerContact } from "@store-ops/db";
import { sendEmail } from "@store-ops/tools";

/**
 * Emails from autonomous jobs. The agent writes markdown; it is rendered to
 * HTML with raw HTML dropped, since parts of it can come from customer text.
 */

const markdown = new Marked({ gfm: true, breaks: false });
markdown.use({ renderer: { html: () => "" } });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function storeUrl(storeId: string, path = ""): string {
  return `${(process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "")}/stores/${storeId}${path}`;
}

export function renderEmail(args: { storeName: string; heading: string; markdown: string; link: { label: string; url: string } }) {
  const body = markdown.parse(args.markdown) as string;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;line-height:1.5">
<p style="color:#64748b;font-size:13px;margin:0">${escapeHtml(args.storeName)}</p>
<h1 style="font-size:20px;margin:4px 0 16px">${escapeHtml(args.heading)}</h1>
<div style="font-size:14px">${body}</div>
<p style="margin-top:24px"><a href="${escapeHtml(args.link.url)}" style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(args.link.label)}</a></p>
<p style="color:#94a3b8;font-size:12px;margin-top:24px">Sent by your Store Ops agent. Change what it sends under Automations.</p>
</div>`;
  const text = `${args.storeName}\n${args.heading}\n\n${args.markdown}\n\n${args.link.label}: ${args.link.url}`;
  return { html, text };
}

/** Emails the store's owner. Failures are logged, never thrown: the result is on the dashboard either way. */
export async function emailOwner(storeId: string, storeName: string, subject: string, heading: string, md: string, link: { label: string; url: string }) {
  try {
    const owner = await storeOwnerContact(storeId);
    if (!owner) return false;
    const { html, text } = renderEmail({ storeName, heading, markdown: md, link });
    await sendEmail({ to: owner.email, subject, html, text });
    return true;
  } catch (err) {
    console.error(`Could not email the owner of store ${storeId}`, err);
    return false;
  }
}
