# Demo video: three minutes

A shot list for recording the product demo. It shows the launch path end to end (sign-up to first digest, a question, an approval, the audit trail) and then the safety story. Record at 1280×800 or larger, browser zoom 110%, with a store seeded with the canonical dataset (`pnpm boutique:reset`) so the numbers are interesting.

**Before recording:** start everything (`pnpm db:up`, `pnpm dev`), with a Claude key in `.env`. Use a fresh email for sign-up. Have a phone or a second browser window on the owner's inbox, or the MCP server's console if Resend is not set up. Set the store's `create_coupon` rule to Ask (the default).

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:15 | Landing page, scroll once through "Safe by design" | "Store Ops Agent runs a store's day-to-day: it answers questions, works on a schedule, and proposes changes, and every action passes rules the owner sets, in code." |
| 0:15–0:35 | Get started → sign up → platform cards | "Sign-up goes straight to connecting a store. Shopify is one approval screen; WooCommerce is an API key. This one is a Supabase store, through a role that can only call a fixed set of functions." |
| 0:35–1:05 | Fill the form → Test and connect → welcome page, digest arrives | "We test the connection before saving anything. The agent starts on its first morning digest right away, from the store's own data: yesterday's sales, what's due, what's late, what's low." Point at "Ready … after you signed up." |
| 1:05–1:20 | Click "see how it was made" → run trace | "Every run has a trace: each tool call, the policy decision for it, tokens and cost in rupees." |
| 1:20–1:50 | Ask the agent: "Which orders are late? Draft an apology to the most overdue one." | "It looks things up rather than guessing. Drafts go to the inbox; the agent never messages customers itself." Open the Inbox for a second. |
| 1:50–2:20 | Ask: "Create a 15% Diwali coupon, DIWALI15, for 100 uses." → "waiting for your approval" → the email → Approve | "Changes wait for the owner by default: in the dashboard, or from a one-time email link that expires in 30 minutes. Approving runs exactly what was proposed." |
| 2:20–2:35 | Rules: set coupons to Automatic, up to 10% | "Owners can trust specific actions with limits. A 15% coupon would now still come back for approval, with the reason." |
| 2:35–2:50 | Activity log, then Pause the agent | "Every change and decision is in an append-only log. One switch pauses every run and every change." |
| 2:50–3:00 | README status table or the eval report | "It works with Shopify, WooCommerce, Supabase and any store that implements the open connector API, and it is measured: a 40-task eval suite per platform, with zero unsafe writes and zero cross-tenant leaks as hard requirements." |

**Cuts if long:** drop the Rules segment (2:20–2:35) first, then the run trace.

**Don'ts:** do not show `.env`, the connection string field unmasked, or real customer data. The canonical dataset's customers are fictional.
