# Store Ops Agent

A multi-store SaaS where any store owner connects their store and an AI agent runs day-to-day operations — answering questions, running scheduled checks, and taking actions — within rules the owner sets. Rashmi Tailoring Studio is customer number one.

The agent decides what to look at and what to do, but every action passes a policy check written in code: reads and drafts run automatically, changes need approval by default, and owners can switch specific actions to automatic with limits.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Monorepo, Postgres + RLS, auth, connect a store, `StoreAdapter`, Supabase adapter, conformance suite | Done |
| 2 | MCP server, agent loop, streamed chat, run traces | Next |
| 3 | Policy engine, approvals, audit log, kill switch | |
| 4 | Shopify adapter | |
| 5 | WooCommerce adapter, custom REST connector spec | |
| 6 | Autonomous jobs (BullMQ), email via Resend | |
| 7 | Evals and hardening | |
| 8 | Onboarding, deploy, launch polish | |

## Layout

```
apps/
  web/       Next.js dashboard: sign-up, stores, connect a store (later: chat, approvals, policies)
  agent/     Agent API (Phase 2)
  mcp/       MCP server: routes tool calls to the run's store adapter via the policy engine (Phase 2)
  worker/    BullMQ job worker (Phase 6)
packages/
  shared/    Normalised types (zod), capabilities, AES-256-GCM credential encryption
  adapters/  StoreAdapter interface, Supabase adapter, canonical dataset, conformance suite
  db/        Prisma schema, migrations with Row-Level Security, tenant-scoped clients
```

## How the pieces fit

- **One adapter interface.** Every platform sits behind `StoreAdapter` (`packages/adapters/src/adapter.ts`) and returns the same normalised types: money in minor units plus a currency code, timestamps in UTC. Each adapter declares its capabilities; a missing capability throws `UNSUPPORTED`.
- **Tenant isolation in the database.** The app connects as the non-owner `storeops_app` role, so RLS always applies. Queries go through `dbForUser(userId)` (dashboard) or `dbForStore(storeId)` (agent runs, jobs), which set `app.user_id` / `app.store_id` per transaction. With no context, tenant tables return nothing.
- **Credentials never leave the server.** They are encrypted with AES-256-GCM before storage and decrypted only to build an adapter.
- **Supabase stores** are reached as a restricted `agent_role` that can only execute the `agent_api` functions — never read tables. See `packages/adapters/src/supabase/boutique-reference.sql`.

## Local development

Requirements: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env   # then fill CREDENTIALS_ENCRYPTION_KEY and SESSION_SECRET (commands are in the file)
pnpm db:up             # platform Postgres :5433, boutique Postgres :5434, Redis :6380
pnpm db:migrate
pnpm boutique:reset    # boutique reference schema + 50 products, 200 orders
pnpm dev               # http://localhost:3100
```

To try it: sign up (any email; for local testing we use `demo@storeops.test` / `demo-owner-pass-2026`), then **Connect a store** with platform Supabase and the connection string `postgresql://agent_role:agent_role@localhost:5434/boutique`.

### Tests

```bash
pnpm test        # all packages (needs the databases running)
pnpm typecheck
```

- `packages/db` — tenant isolation: owner A tries to read and write store B's rows by every route. Pass condition: zero leaks.
- `packages/adapters` — the conformance suite (`src/testing/conformance.ts`), run against every adapter with the same canonical dataset. Pass condition: 100%.
- `packages/shared` — credential encryption.

## Connecting the real boutique (Supabase)

1. In the Supabase SQL editor, create the `agent_api` schema and functions from `boutique-reference.sql`, rewriting each function body against the boutique's real tables while keeping the signatures and JSON shapes. Do **not** run the `DROP TABLE` lines against production.
2. Create `agent_role` with a strong password and grant it only `EXECUTE` on those functions.
3. Connect the store in the dashboard with that role's connection string (the direct or session-pooler connection, with `sslmode=require`).
4. Run the conformance suite against a copy of the boutique database to confirm the functions behave.

See [DECISIONS.md](DECISIONS.md) for the reasoning behind these choices.
