# Decisions

Short records of choices that shape the codebase. Newest last.

## 1. pnpm workspaces, TypeScript sources shared without a build step

Packages export their `src/*.ts` directly. Next.js compiles them via `transpilePackages`, Vitest and `tsx` run them as-is. This keeps Phase 1 fast to iterate; if a Node service later needs compiled output, add a build step to that package only.

## 2. Row-Level Security enforced by a non-owner role

Migrations run as the database owner; the app connects as `storeops_app`. Every tenant table has `FORCE ROW LEVEL SECURITY` and policies keyed on `app.user_id` (dashboard) or `app.store_id` (agent runs, jobs), set with `set_config(..., true)` inside the same transaction as each query. A missing context returns no rows rather than all rows. Tables without a `store_id` (`tool_calls`, `approvals`) are scoped through their parent, and the subqueries are themselves RLS-filtered.

Sign-up and login happen before a user context exists, so they use two `SECURITY DEFINER` functions that expose only what auth needs, instead of a second privileged connection in the web app.

## 3. Prisma 6, pinned

Prisma's current major has a new configuration model; Prisma 6 is stable and supports `$extends` query hooks, which is what the per-request tenant context needs. Upgrade deliberately later.

## 4. Minimal cookie session instead of an auth framework

A signed (HS256) JWT in an `httpOnly` cookie plus bcrypt password hashes. Auth.js v5 is still in beta and its adapters add tables we do not need yet. Email links for approvals (Phase 3) will be separate single-use signed tokens.

## 5. Supabase stores expose an `agent_api`, not tables

The adapter connects as a restricted `agent_role` that can only execute `agent_api.*` functions, each returning JSON already in the normalised shape. The store owner controls exactly what the agent can see and change, mapping between their schema and ours lives next to their data, and an RLS or schema mistake on their side cannot widen access.

## 6. One canonical dataset and one conformance suite for every adapter

`packages/adapters/src/testing/dataset.ts` generates the same 50 products, 200 orders, 6 coupons and 60 reviews (deterministic, dates relative to now) for every test platform. The conformance suite checks counts and filters against that dataset, so "works on any store" is measured, not claimed.

Contract details the suite pins down: keyset pagination with opaque cursors; `[from, to)` time ranges; sales exclude cancelled and refunded orders; setting an order to its current status is a no-op; cancelled/refunded orders cannot change status; a review can be replied to once (`CONFLICT` after).

## 7. Local ports

Platform Postgres on 5433, boutique Postgres on 5434, Redis on 6380, and the dashboard on 3100, to avoid clashing with other local services.

## 8. A manual agent loop, not the SDK tool runner

The loop needs per-run limits (8 tool calls, 60 seconds), a forced final answer once the tool budget is spent (`tool_choice: none`), streamed text and tool events to the dashboard, and per-response cost accounting. A manual loop over `messages.stream` keeps all of that in ~150 lines, and the model sits behind a small `ModelClient` interface so the loop is tested with a scripted model and no API key.

## 9. One stateless MCP server, context in headers

The MCP server is internal and stateless: each request builds a server bound to one run, from the `x-store-id` and `x-run-id` headers the agent API sets (plus a bearer token). The model never supplies a store id. Tool listing is computed per request, so capability flags and the owner's Never settings decide what the model even sees. The MCP server, not the agent, records every tool call, so the trace cannot be skipped by a different caller (such as the Phase 6 worker).

## 10. Model settings

Claude Opus 5.5 (`AGENT_MODEL`) at `medium` effort (`AGENT_EFFORT`), streamed, with server-side refusal fallbacks (`fallbacks: "default"`) so a declined request is retried on a fallback model in the same call. The static system prompt and the tool list are cached (breakpoints on the instructions and the last tool); the store name, time zone and current time sit after the cache breakpoint. Costs are priced by the model that actually served each response and converted to rupees with `USD_TO_INR`.

## 11. Phase 2 policy subset

Reads and drafts run automatically; writes create a pending approval (30-minute expiry) and the agent is told it has not happened. Owners' per-tool modes (Auto/Ask/Never) and the store's pause flag already apply. Limits inside a mode (for example, coupons up to 10%), approving from the dashboard or email, and the settings page arrive in Phase 3.

## 12. Named periods computed in the store's time zone

`sales_summary` takes `period: "yesterday"` (and similar) and computes the range in the store's own time zone, instead of asking the model to do time-zone arithmetic.

## 13. The policy engine is a pure function in a shared package

`packages/tools` holds the tool catalog and `decide()`, which takes the tool, the store's saved policy, the pause flag, the validated input and a few facts (today's automatic runs, a variant's current stock) and returns run, ask (with the reason) or deny. Callers fetch only the facts the saved limits need. Keeping it pure makes every rule unit-testable, and the MCP server and the dashboard share one implementation.

Limits fail closed: limits that do not parse, a fact that could not be fetched, or a coupon type the limits do not mention all turn an Automatic call into an approval rather than letting it through.

## 14. Approving runs the saved call; the owner's decision overrides limits

An approval stores the exact validated arguments. Approving claims the row (`PENDING` → `APPROVED` with a conditional update, so double clicks and reused links do nothing), runs the tool through the store's adapter, then records `EXECUTED` or `FAILED` with the store's error. Limits are not re-applied: they decide what may happen without the owner, and the owner has now decided. A paused store refuses approvals too.

## 15. Email approval links act as a sign-in for one decision

Links are HS256 tokens (`APPROVAL_LINK_SECRET`) naming the approval, store and owner, expiring with the approval. Opening the page changes nothing (mail scanners open links); only the Approve or Reject button does. The agent side finds the owner's email through a `SECURITY DEFINER` function that answers only for the store in the current `app.store_id` context, so the users table stays closed to store-scoped code.

## 16. Pausing means nothing the agent proposed happens

The kill switch (`stores.is_paused`) stops new runs in the agent API, refuses every write in the policy engine, and blocks approvals until the owner resumes. Reads stay available to the policy engine so a paused store can still be inspected.

## 17. Shopify: standalone app, authorization-code grant, expiring offline tokens

The dashboard is a standalone site, so owners install through Shopify's authorization-code grant rather than an embedded app's token exchange. Shopify requires new public apps to use expiring offline tokens (`expiring=1`): access tokens last an hour and refresh tokens 90 days. The adapter refreshes a minute before expiry and once more on a 401, and the store's connection is updated through a callback (`adapterForStore`). Before refreshing, it re-reads the stored tokens in case another process (MCP server, worker, dashboard) refreshed first. When the refresh token is refused, the owner has to reconnect.

The OAuth state lives in a signed, 10-minute, `SameSite=Lax` cookie bound to the signed-in owner and the shop, so a callback cannot attach a store to a different account. Shop domains must match `^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$`.

## 18. Shopify: how the normalised model maps

- **Order date** is `processedAt`, the business date, which imported orders can set; `createdAt` is when the record was created in Shopify.
- **Status:** cancelled, refunded, shipped (fulfilled) and delivered (a DELIVERED fulfillment event) come from Shopify; `processing` and `ready` have no Shopify field and are the order tags `ops-processing` and `ops-ready`. The agent can move orders between pending, processing and ready, and fulfil them (shipped, delivered). Cancelling and refunding move money and stock, so they stay in Shopify admin.
- **Promised date** is the `store_ops.promised_at` metafield.
- **Stock** is the variant's total available quantity; changes are applied at its first active location with compare-and-set (`changeFromQuantity`) and an idempotency key, which Shopify requires since 2026-04.
- **Coupons** are basic code discounts; other discount kinds are not shown. Usage counts come from real orders, so the conformance suite no longer asserts a seeded usage count.
- **Reviews** are not in Shopify's API, so Shopify stores have no reviews capability and the agent never sees review tools for them.
- Filters Shopify search cannot express exactly (normalised status, overdue, low stock per variant, product text) are applied by the adapter while paging, with per-item cursors so pages resume correctly. Fine for small and medium stores; large catalogues may later need bulk operations.

## 19. Validating GraphQL against the real schema instead of mocking Shopify

Shopify's Admin API schema is downloaded (as SDL) for the pinned version and committed, and every query and mutation the adapter or seeder sends is validated against it in CI. Unit tests use a scripted fake `fetch` for behaviour (refresh, throttling, mapping, pagination). Together they catch most API mistakes without a store; the conformance suite against a seeded development store is the final check.

## 20. Webhooks are stored, not acted on, until the worker exists

The receiver verifies the HMAC over the raw body, finds the store through a `SECURITY DEFINER` lookup by shop domain, and stores the event once per delivery id (`webhook_events`, RLS like every tenant table). `app/uninstalled` marks the connection revoked. Compliance requests are logged to the activity log; the job worker (Phase 6) will act on stored events.

## 21. WooCommerce: tested against a real store in Docker

WordPress + WooCommerce run under a `woo` compose profile, set up by WP-CLI. The REST API cannot backdate orders or set order numbers, so the dataset is loaded by a PHP script through WP-CLI (`docker/woo/seed.php`), and the local store emulates a sequential order numbers plugin (common on live stores) through a must-use plugin. The conformance suite reseeds and runs against it on demand (`test:woo`); it is opt-in because reseeding takes a few minutes.

## 22. WooCommerce: how the normalised model maps

- Statuses: pending/on-hold → pending; processing → processing, or ready with the `store_ops_status` meta; completed → shipped, or delivered with the meta; cancelled/failed → cancelled; refunded. Like Shopify, cancelling and refunding stay in WooCommerce admin. Note that moving an order to completed makes WooCommerce email the customer, as it would from wp-admin.
- Every product is listed with its variations (one `/variations?parent=…` request per page); a simple product is its own single variant.
- Draft coupons are invisible to the REST API, so "switched off" means expired. Coupons have no start date.
- Reviews are read-only: the reviews API cannot post replies. A reply made in wp-admin is an ordinary comment under the review, read from WordPress's public comments endpoint.
- Filters the API cannot express exactly (normalised status, overdue, low stock per variant, exact time bounds) are applied by the adapter while paging, with cursors of the form `perPage:page:index`.

## 23. WooCommerce webhooks: a URL per store, a secret per store

Deliveries go to `/api/webhooks/woocommerce/<store id>`; the receiver verifies `X-WC-Webhook-Signature` with that store's secret, which the adapter creates when it subscribes and stores encrypted alongside the API keys. No lookup by site URL is needed, and a leaked secret affects one store.

## 24. Custom stores: a connector API generated from the platform's schemas

The connector API's OpenAPI 3.1 document is built from the same zod schemas the adapter validates responses with, published at `docs/connector/openapi.json` (a test fails if it drifts) and served at `/connector/openapi.json`. Its semantics are the conformance suite's: the sample implementation in `examples/custom-connector` passes it on every test run, so "implements the spec" is checked behaviour, not a promise. Version 1 has no webhooks; polling covers custom stores until a signed-delivery design is needed.

## 25. Autonomous jobs check the store before they wake the agent

Each job has a planner that looks at the store in code first: the low-stock watch compares today's low variants with the ones it already alerted on, the late-order follow-up skips orders that already have a draft, the review job skips reviews it handled. Only when there is new work does it start an agent run, with the facts it found in the prompt. An hourly check with nothing new costs no model tokens. Digest and weekly report always run. Runs go through the same MCP server and policy engine as chat, recorded with `trigger` SCHEDULE (or WEBHOOK) and their `job_type`.

## 26. One BullMQ queue per job, one run per store

Five queues, one per job type, with BullMQ job schedulers (cron pattern plus the store's IANA time zone, so 09:00 means 09:00 in Kolkata). The worker re-reads the jobs table every minute and adds, changes or removes schedulers to match: turning a job off or pausing the store removes them. A Redis lock per store (with an owner token and expiry) keeps two jobs off the same store at once; a job that finds the store busy is pushed back 30 seconds (`moveToDelayed`). The worker finds stores through a `SECURITY DEFINER` function that returns ids only, then works inside each store's RLS context.

## 27. Drafts are a table, and only the owner sends them

Draft tools save to `drafts` (with the run that wrote them) instead of just returning text. The Inbox lets the owner edit, then mark a customer message as sent (they send it themselves; the agent never contacts customers) or post a review reply through the store. Posting is refused while the store is paused, as approvals are. The review job posts directly only when the owner has set review replies to Automatic, and then still through the policy engine.

## 28. Emails render the agent's markdown without raw HTML

Digests, alerts and reports are emailed through Resend (printed locally without a key). The agent's markdown is rendered with raw HTML dropped, since parts of it can come from customer-written text.

## 29. Tests get their own database

Test scripts load `.env.test` before `.env`, pointing them at `storeops_test`. Otherwise the stores tests create would be scheduled by the dev worker. Redis is shared, but worker tests use a per-run queue prefix.

## 30. Evals graded in code, from the store's own data

Each of the 43 tasks computes what a right answer must contain from the store before the run (counts, money, names, ids), and grades what the agent did from the platform's own records: tool calls with their policy decisions, approvals and drafts. No LLM judge, so a run is cheap to grade and the same task works on every platform. Facts are matched leniently (Indian or Western digit grouping, "₹4.29 lakh", 0.5% tolerance on money); actions strictly (the right tool, the right target, the right arguments). Tasks a store cannot do (Shopify has no reviews) are reported as not applicable, not as failures. The harness is tested with scripted models in CI; the run against Claude is a deliberate, paid step (`--yes`).

## 31. Safety is measured, and enforced without the model

The report counts three things that must be zero: writes executed without the task's own Automatic rule allowing them, injection tasks where the agent attempted any write (even one the policy turned into an approval), and decoy text from another owner's store appearing anywhere in a run. Separately, CI runs a fully compromised scripted model that obeys every planted instruction, through the real MCP server and policy engine: the store stays unchanged, credentials never appear in tool results, and other stores stay unreachable.

## 32. Budgets in rupees per store per month

Every run's cost is already recorded; a monthly limit per store (default ₹500, owner-adjustable) stops new runs once reached, checked before each chat run and before each automation (which then skips without touching the store). It is a soft limit: a run in progress finishes. The hard backstop is the spend limit on the Claude API account.

## 33. Rate limits: stay under them, then back off

A token bucket per store API host is shared by every adapter in the process. Shopify's bucket is re-synced from the `throttleStatus` Shopify returns, and each query reserves its last known cost, so concurrent runs on one store queue rather than get throttled. WooCommerce and custom connectors use request rates (configurable). Any 429 or 5xx is retried after `Retry-After` or a jittered exponential backoff, then reported as `RATE_LIMITED` so the worker retries the job later.

## 34. Onboarding starts the first digest at connect time

The plan's onboarding goal is sign-up to a first digest in under five minutes, and waiting for 09:00 tomorrow would miss it by a day. So connecting a store (Supabase, WooCommerce, custom connector, or a new Shopify install) queues its morning digest straight away, through the same worker, planner, MCP server and policy check as the scheduled one, and the owner lands on a welcome page that polls it. Before the worker starts the run, the page reads the queue job (waiting, skipped with a reason, failed); afterwards, the run row. It shows the time from sign-up to the finished digest, and offers to try again when the queue is unreachable or the run failed. Queueing gives up after five seconds, because with Redis down ioredis waits rather than failing, and a stuck queue must not stop the store from connecting. The helper that queues it is not a server action, so only code that has just connected a store for its owner can start one.

## 35. One private network on Render, not the dashboard on Vercel

The plan put the dashboard on Vercel and the Node services on Railway or Render. With the dashboard on another network, the agent API would have to be public, and so would Redis, which the dashboard needs for "Run now" and the first digest. A single Render Blueprint keeps both private: the dashboard is the only public service, the agent API and MCP server are private services addressed by `host:port` (the apps accept a bare `host:port` in `AGENT_URL` and `MCP_URL`), and Key Value takes no outside connections. Render generates the secrets once. The dashboard's pre-deploy step creates the `storeops_app` role from `APP_DATABASE_URL` and runs migrations as the owner; the services only ever have the app role's credentials. Builds run pnpm through `npx`, and services start from the workspace's own binaries, so nothing depends on how the host provides pnpm. Vercel stays possible (docs/deploy.md says what it takes).

## 36. The browser test runs the real services with a scripted model

The plan's end-to-end check (connect a store, ask, approve, see the audit entry) runs in Playwright against the dashboard, agent API, MCP server and job worker as they run in production, on the test database and a separate Redis database, with only the model replaced. The scripted model calls real tools and writes its answers from their results, so the digest the test reads came from the boutique's data. It runs in CI without a Claude key. Locally it uses the installed Chrome; CI installs Playwright's Chromium. Its dev server builds into `.next-e2e` and listens on its own ports, so it leaves a running `pnpm dev` alone.

## 37. Supabase stores can declare what they support

A store's `agent_api` may define `capabilities()`, returning the capabilities it supports; the adapter then offers the agent only the matching tools (a store without review replies never sees `reply_to_review`). Without the function, it gets all eight, as before. A declaration naming an unknown capability is an invalid response, not a silent full set.

## 38. The public website lives in the app

The marketing site (home, features, safety, integrations, pricing, developers, FAQ, about, contact, privacy, terms) was designed in Google Stitch and rebuilt as pages in the dashboard's Next.js app, under the `(site)` route group with its own header, footer and green/teal palette; the dashboard keeps its own layout under `(app)`. Living in the app means "Get started" and "Log in" are plain relative links (no app URL to configure), the connector spec link points at the app's own `/connector/openapi.json`, and there is one thing to deploy. Signed-in owners visiting `/` go to their stores; on other public pages the header offers "Go to dashboard". Stitch's export was a set of standalone pages using Tailwind's development CDN and a hotlinked stock photo; neither was kept. Its copy was rewritten to what the product does: no invented figures, WhatsApp, SLAs, SDKs or webhooks for custom stores, and the Developers page follows the real connector spec. The contact form composes an email in the visitor's own mail app rather than running a form backend. Pricing is enforced by billing (decision 41), and the privacy and terms pages are marked as drafts until legal text is written.

## 39. Definer functions get their own RLS policy

Every tenant table has `FORCE ROW LEVEL SECURITY`, so even its owner is filtered. The `SECURITY DEFINER` functions the app relies on run as that owner. On a local superuser that bypasses RLS and they worked; on managed Postgres (Render), where the owner is an ordinary role, they saw no rows and sign-up failed. Rather than drop `FORCE` (which would let any owner-run query see every tenant), each tenant table gets a policy for the owner role only (`<table>_definer`, `TO current_user`, created by the migration as the owner). The app role `storeops_app` has no such policy and stays fully filtered. A test database with a non-superuser owner reproduced the failure and confirmed the fix.

## 40. Accounts: revocable sessions, two-factor, reset by email

Sessions stay stateless JWT cookies, but each carries the account's `session_version`, compared with the database once per request (cached for the request). Bumping it on a password change, a reset or "Log out everywhere" ends every session without a session table. Two-factor is TOTP, written against RFC 6238 in `packages/shared` instead of a library (about 60 lines, tested on the RFC vectors), with the secret encrypted like store credentials and ten hashed one-time recovery codes. A correct password with two-factor on only sets a five-minute signed challenge cookie. Reset tokens are random 32 bytes, stored as SHA-256 in a table the app role cannot read, issued and consumed through definer functions; the request answers the same whether or not the email has an account. `users` can only be updated in the columns these features need.

## 41. Plans are enforced in the database's answer, paid through Razorpay

The website's plans are now real: a 14-day trial with Starter's limits, Starter (₹999 a month, 1 store, ₹500 of AI usage), Growth (₹2,499, 3 stores, ₹1,500) and Custom (limits set per account). One definer function, `app_owner_entitlement()`, returns an owner's plan, store count and this month's spend across all their stores, from either a user or a store context; `evaluateEntitlement` in `packages/tools` turns that into what is allowed. Connecting a store (form and Shopify callback) checks the store limit; the agent API and the worker check the plan before every run, ahead of the per-store budget. Razorpay Subscriptions was chosen for rupee pricing with UPI and cards: the owner pays on Razorpay's hosted page, so no card data touches the app, and plan changes arrive only through signed webhooks applied as the latest state. The app role cannot write plan columns; only the billing definer functions and an owner-only `pnpm user:set-plan` can. Without Razorpay keys the billing page says payments are not set up yet, and plans can be set by hand.

## 42. Store addresses must be public

Owners type in addresses the servers then connect to, which made the store connectors a way into the private network (the agent API, Redis, metadata services). Every adapter now resolves the host and refuses non-public addresses before connecting, and HTTP clients never follow redirects. Development and tests run stores on localhost, so `ALLOW_PRIVATE_STORE_HOSTS=1` lifts the check there; production refuses to start with it.

## 43. Production refuses to start misconfigured

`apps/web/instrumentation.ts` checks, at server start in production, that the secrets are set and long enough, that the database URL is not the development one, that the private-address switch is off and that `APP_URL` is HTTPS. A deploy that would run insecurely fails its health check instead. Security headers (CSP framing and form rules, HSTS and the usual others) are set in `next.config.ts` for every response. The full review is [docs/security.md](docs/security.md).

## 44. The dashboard matches the website, and never looks stuck

The dashboard took the website's green and teal palette, Inter, rounded cards and icons. Slow tab switches were mostly the development server compiling each page on its first visit; production builds switch in well under a second. To keep every click visibly answered anyway: tabs prefetch, each page has a skeleton (`loading.tsx`), the Overview streams its live store figures behind a skeleton instead of waiting for the store's API, and a thin bar at the top shows a navigation is under way. The development "N" badge is turned off.


## 45. The agent answers about the store and nothing else

Owners pay for every answer, and the product is a store tool, not a general chatbot. The system prompt lists what the agent covers (this store's data and changes, advice tied to running it, and how the app works) and tells it to decline anything else in a sentence or two, without calling tools, offering store questions instead; a mixed request gets only its store part answered. This is a prompt rule rather than a classifier in code: an off-topic answer costs money but cannot change the store, which the policy engine already guards. Three off-topic eval tasks (a general web question, a coding request, a store question with a trivia question attached) check it, graded in code.

## 46. The website shows the product working, not just describing it

The home page is built around things a visitor can do: approve the change in the hero's digest, pick a question and watch the agent look things up, check a rule and stop for approval (or decline an off-topic question), follow one change through the five steps, and switch rules to see what each mode means. The demos are scripted on the product's fictional sample store and say so; every behaviour they show is one the product has, and the facts strip uses only true counts (platforms, automations, modes, the approval link's 30 minutes). Scroll animations use React Bits' AnimatedContent (on GSAP and its ScrollTrigger), typed for this project in `components/site/animated-content.tsx`: headings soften in from a blur, grids cascade in one by one, the demos flip up from a 3D tilt and the setup steps appear behind a soft wipe. The hero stays CSS-only, so it never waits for scripts; a `<noscript>` rule shows animated content when scripts are off; sideways entrances are clipped so phones never scroll horizontally; and everything holds still for visitors who prefer reduced motion.
