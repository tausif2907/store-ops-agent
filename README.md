# Store Ops Agent

A multi-store SaaS where any store owner connects their store and an AI agent runs day-to-day operations — answering questions, running scheduled checks, and taking actions — within rules the owner sets. Rashmi Tailoring Studio is customer number one.

The agent decides what to look at and what to do, but every action passes a policy check written in code: reads and drafts run automatically, changes need approval by default, and owners can switch specific actions to automatic with limits.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Monorepo, Postgres + RLS, auth, connect a store, `StoreAdapter`, Supabase adapter, conformance suite | Done |
| 2 | MCP server, agent loop, streamed chat, run traces | Done |
| 3 | Policy engine, approvals, audit log, kill switch | Done |
| 4 | Shopify adapter | Done (conformance run needs a dev store: [setup](docs/shopify-setup.md)) |
| 5 | WooCommerce adapter, custom REST connector spec | Next |
| 6 | Autonomous jobs (BullMQ), email via Resend | |
| 7 | Evals and hardening | |
| 8 | Onboarding, deploy, launch polish | |

## Layout

```
apps/
  web/       Next.js dashboard: stores, chat, approvals, rules, activity log, run traces, kill switch
  agent/     Agent API: the agent loop (Claude), step and time limits, cost tracking, SSE stream
  mcp/       MCP server: the 12 store tools, routed to the run's store adapter through the policy check
  worker/    BullMQ job worker (Phase 6)
packages/
  shared/    Normalised types (zod), capabilities, AES-256-GCM credential encryption
  adapters/  StoreAdapter interface, Supabase and Shopify adapters, canonical dataset, conformance suite
  tools/     The tool catalog, the policy engine, approvals (dashboard and email links)
  db/        Prisma schema, migrations with Row-Level Security, tenant-scoped clients
```

## How the pieces fit

- **One adapter interface.** Every platform sits behind `StoreAdapter` (`packages/adapters/src/adapter.ts`) and returns the same normalised types: money in minor units plus a currency code, timestamps in UTC. Each adapter declares its capabilities; a missing capability throws `UNSUPPORTED`.
- **Tenant isolation in the database.** The app connects as the non-owner `storeops_app` role, so RLS always applies. Queries go through `dbForUser(userId)` (dashboard) or `dbForStore(storeId)` (agent runs, jobs), which set `app.user_id` / `app.store_id` per transaction. With no context, tenant tables return nothing.
- **Credentials never leave the server.** They are encrypted with AES-256-GCM before storage and decrypted only to build an adapter.
- **Agent runs go through MCP.** The dashboard's server checks the owner owns the store, then calls the internal agent API, which streams events back. The agent offers Claude only the tools the MCP server lists for that store (capability flags and the owner's Never settings filter them). Every call passes the policy check — reads and drafts run, writes are saved as approvals by default — and is recorded with its decision and latency. The store and run come from headers the agent API sets, never from the model.
- **Owners set the rules.** Each tool is Automatic, Ask me or Off, per store. Automatic writes can carry limits (largest coupon discount and uses, largest stock change, allowed order statuses, runs per day); a call over a limit becomes an approval that says which limit it broke. Approvals expire after 30 minutes and can be decided in the dashboard or from a signed one-time email link, which runs the exact saved arguments. **Pause the agent** stops every run and every change at once. Every change, rule edit, pause and decision lands in the store's append-only activity log.
- **Limits per run:** 8 tool calls, 60 seconds, and a cost in rupees on every run (`agent_runs`, `usage`).
- **Shopify stores** connect through Shopify's OAuth approval screen. The app uses expiring offline tokens; adapters refresh them and save the new tokens encrypted. Webhooks are verified by HMAC, stored per store, and `app/uninstalled` marks the connection revoked. Every GraphQL document is validated in tests against Shopify's Admin API schema (2026-10). See [docs/shopify-setup.md](docs/shopify-setup.md).
- **Supabase stores** are reached as a restricted `agent_role` that can only execute the `agent_api` functions — never read tables. See `packages/adapters/src/supabase/boutique-reference.sql`.

## Local development

Requirements: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env   # then fill CREDENTIALS_ENCRYPTION_KEY and SESSION_SECRET (commands are in the file)
pnpm db:up             # platform Postgres :5433, boutique Postgres :5434, Redis :6380
pnpm db:migrate
pnpm boutique:reset    # boutique reference schema + 50 products, 200 orders
pnpm dev               # dashboard :3100, agent API :3200, MCP server :3201
```

To try it: sign up (any email; for local testing we use `demo@storeops.test` / `demo-owner-pass-2026`), then **Connect a store** with platform Supabase and the connection string `postgresql://agent_role:agent_role@localhost:5434/boutique`.

The chat needs a Claude API key: set `ANTHROPIC_API_KEY` in `.env` (and the two internal tokens, `AGENT_INTERNAL_TOKEN` and `MCP_INTERNAL_TOKEN`; commands are in `.env.example`), then open a store and choose **Ask the agent**. Each answer links to its trace: tool calls, policy decisions, tokens and cost.

Approval emails go through Resend when `RESEND_API_KEY` is set; without it they are printed in the MCP server's console, link included. To try rules and approvals without a Claude key, send one tool call through the MCP server as the agent would:

```bash
pnpm --filter @store-ops/agent try-tool <storeId> create_coupon '{"code":"FESTIVE15","type":"percent","value":15,"usageLimit":50}'
```

### Tests

```bash
pnpm test        # all packages (needs the databases running)
pnpm typecheck
```

- `packages/db` — tenant isolation: owner A tries to read and write store B's rows by every route. Pass condition: zero leaks.
- `packages/adapters` — the conformance suite (`src/testing/conformance.ts`), run against every adapter with the same canonical dataset. Pass condition: 100%. Shopify adds schema validation of every query, unit tests against a fake Shopify (OAuth, webhook signatures, token refresh, throttling, mapping), and the same conformance suite against a seeded development store when one is configured.
- `packages/shared` — credential encryption, store-time-zone periods.
- `packages/tools` — the policy engine (modes, every limit, kill switch, fail-closed on bad limits) and approvals against the boutique: approve runs once, reject changes nothing, expiry, pause, cross-store refusal, signed links.
- `apps/mcp` — the MCP server over HTTP with a real MCP client: tool listing, approvals, Auto writes and audit, Never, kill switch, cross-store runs refused.
- `apps/agent` — the loop with a scripted model (tool limit, time limit, refusals, cost), and the full chain over HTTP: agent API → MCP → boutique database.

## Connecting the real boutique (Supabase)

1. In the Supabase SQL editor, create the `agent_api` schema and functions from `boutique-reference.sql`, rewriting each function body against the boutique's real tables while keeping the signatures and JSON shapes. Do **not** run the `DROP TABLE` lines against production.
2. Create `agent_role` with a strong password and grant it only `EXECUTE` on those functions.
3. Connect the store in the dashboard with that role's connection string (the direct or session-pooler connection, with `sslmode=require`).
4. Run the conformance suite against a copy of the boutique database to confirm the functions behave.

See [DECISIONS.md](DECISIONS.md) for the reasoning behind these choices.
