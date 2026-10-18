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
