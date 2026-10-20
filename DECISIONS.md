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
