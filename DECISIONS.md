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
