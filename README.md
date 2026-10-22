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
| 5 | WooCommerce adapter, custom REST connector spec | Done |
| 6 | Autonomous jobs (BullMQ), email via Resend | Done |
| 7 | Evals and hardening | Done (eval run needs a Claude key) |
| 8 | Onboarding, landing page, deploy blueprint, browser end-to-end test | Done (going live, the eval report and the demo video are run by hand: [deploy](docs/deploy.md), [evals](#evals), [demo script](docs/demo-script.md)) |

## Layout

```
apps/
  web/       Next.js dashboard: stores, chat, approvals, rules, activity log, run traces, kill switch
  agent/     Agent API: the agent loop (Claude), step and time limits, cost tracking, SSE stream
  mcp/       MCP server: the 13 store tools, routed to the run's store adapter through the policy check
  worker/    BullMQ worker: the five autonomous jobs on each store's schedule, one run per store at a time
evals → packages/evals: the 40-task eval suite, run per platform against the real agent
e2e/         Playwright: sign-up to first digest to an approved change, in a browser against the real services
examples/
  custom-connector/  Sample implementation of the connector API (passes the conformance suite)
docs/                Deploying, setup guides for Shopify, WooCommerce and custom connectors, the connector OpenAPI spec, the demo script
render.yaml          The whole platform as a Render Blueprint
packages/
  shared/    Normalised types (zod), capabilities, AES-256-GCM credential encryption
  adapters/  StoreAdapter interface; Supabase, Shopify, WooCommerce and custom REST adapters;
             connector API spec; canonical dataset; conformance suite
  tools/     The tool catalog, the policy engine, approvals, job definitions and queues
  db/        Prisma schema, migrations with Row-Level Security, tenant-scoped clients
```

## Architecture

Runs start from the owner's chat or from the job worker. Either way, every tool call goes through the MCP server's policy check and then the store's own adapter; the agent never touches a store directly.

```mermaid
flowchart LR
  owner([Owner]) --> web["Dashboard<br/>Next.js"]
  web -->|chat, SSE| agent["Agent API<br/>agent loop, limits, cost"]
  web -->|Run now, first digest| redis[("Redis<br/>BullMQ")]
  redis --> worker["Job worker<br/>5 automations"]
  agent & worker -->|Messages API| claude([Claude])
  agent -->|MCP, store and run in headers| mcp["MCP server"]
  worker -->|same agent loop, in-process| mcp
  mcp --> policy{"Policy engine<br/>Automatic / Ask / Off,<br/>limits, pause"}
  policy -->|run| adapters["StoreAdapter"]
  policy -->|ask| approvals["Approvals<br/>dashboard + email link"]
  approvals -->|approved| adapters
  adapters --> shopify([Shopify]) & woo([WooCommerce]) & supa(["Supabase agent_api"]) & custom([Custom connector])
  web & mcp & worker --> db[("Postgres<br/>RLS per owner and store")]
```

The worker runs the same agent loop in-process and reaches the same MCP server, so automations and chat share one policy check and one trace. See [docs/deploy.md](docs/deploy.md) for how the services are laid out in production.

## How the pieces fit

- **One adapter interface.** Every platform sits behind `StoreAdapter` (`packages/adapters/src/adapter.ts`) and returns the same normalised types: money in minor units plus a currency code, timestamps in UTC. Each adapter declares its capabilities; a missing capability throws `UNSUPPORTED`.
- **Tenant isolation in the database.** The app connects as the non-owner `storeops_app` role, so RLS always applies. Queries go through `dbForUser(userId)` (dashboard) or `dbForStore(storeId)` (agent runs, jobs), which set `app.user_id` / `app.store_id` per transaction. With no context, tenant tables return nothing.
- **Credentials never leave the server.** They are encrypted with AES-256-GCM before storage and decrypted only to build an adapter.
- **Onboarding takes minutes.** Sign-up leads straight to picking a platform and connecting; the connection is tested before anything is saved. Connecting queues the store's first morning digest at once, and a welcome page shows it being written from the store's own data, with how long it took from sign-up.
- **Agent runs go through MCP.** The dashboard's server checks the owner owns the store, then calls the internal agent API, which streams events back. The agent offers Claude only the tools the MCP server lists for that store (capability flags and the owner's Never settings filter them). Every call passes the policy check — reads and drafts run, writes are saved as approvals by default — and is recorded with its decision and latency. The store and run come from headers the agent API sets, never from the model.
- **Owners set the rules.** Each tool is Automatic, Ask me or Off, per store. Automatic writes can carry limits (largest coupon discount and uses, largest stock change, allowed order statuses, runs per day); a call over a limit becomes an approval that says which limit it broke. Approvals expire after 30 minutes and can be decided in the dashboard or from a signed one-time email link, which runs the exact saved arguments. **Pause the agent** stops every run and every change at once. Every change, rule edit, pause and decision lands in the store's append-only activity log.
- **The agent works on its own.** Five automations run on each store's schedule, in its own time zone: a morning digest, an hourly low-stock watch, a late-order follow-up that drafts apologies, a negative-review response, and a Monday report. Each first checks the store in code and only starts an agent run when there is something to do. Results go to the owner by email (Resend) and to the dashboard; drafts wait in the Inbox, where the owner sends or posts them. Owners switch automations on and off, change their times and run them now under **Automations**.
- **Limits per run:** 8 tool calls, 60 seconds, and a cost in rupees on every run (`agent_runs`, `usage`).
- **Budgets per store:** a monthly limit in rupees (default `DEFAULT_MONTHLY_BUDGET_INR`, ₹500; owners change it under Runs). Once it is used, chat and automations stop for that store until the month turns or the limit is raised. Also set a hard monthly spend limit on the Claude API account itself.
- **Rate limits per platform:** every store has a client-side token bucket, so the agent stays under platform limits instead of hitting them: Shopify's is cost-based and re-synced from the throttle status in each response; WooCommerce (`WOO_REQUESTS_PER_SECOND`, 5) and custom connectors (`CONNECTOR_REQUESTS_PER_SECOND`, 10) are per request. Rejections are retried after `Retry-After` or with jittered exponential backoff.
- **Shopify stores** connect through Shopify's OAuth approval screen. The app uses expiring offline tokens; adapters refresh them and save the new tokens encrypted. Webhooks are verified by HMAC, stored per store, and `app/uninstalled` marks the connection revoked. Every GraphQL document is validated in tests against Shopify's Admin API schema (2026-10). See [docs/shopify-setup.md](docs/shopify-setup.md).
- **WooCommerce stores** connect with REST API keys (Basic auth over HTTPS, signed OAuth 1.0a over HTTP). Webhooks go to a per-store URL and are verified with a secret the adapter creates. See [docs/woocommerce-setup.md](docs/woocommerce-setup.md).
- **Custom-built stores** implement the connector API ([docs/custom-connector.md](docs/custom-connector.md)); the OpenAPI spec is generated from the same schemas the platform validates with, and a sample implementation passes the conformance suite.
- **Supabase stores** are reached as a restricted `agent_role` that can only execute the `agent_api` functions — never read tables. See `packages/adapters/src/supabase/boutique-reference.sql`.

## Local development

Requirements: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env   # then fill CREDENTIALS_ENCRYPTION_KEY and SESSION_SECRET (commands are in the file)
pnpm db:up             # platform Postgres :5433, boutique Postgres :5434, Redis :6380
pnpm db:migrate
pnpm boutique:reset    # boutique reference schema + 50 products, 200 orders
pnpm dev               # dashboard :3100, agent API :3200, MCP server :3201, job worker
```

To try it, open http://localhost:3100, sign up (any email; for local testing we use `demo@storeops.test` / `demo-owner-pass-2026`) and pick **Supabase / Postgres** with the connection string `postgresql://agent_role:agent_role@localhost:5434/boutique`. The welcome page then shows your first digest as the worker writes it (this needs the Claude key below).

The chat needs a Claude API key: set `ANTHROPIC_API_KEY` in `.env` to a key from the Claude Console (Settings → API keys; the agent API logs at startup whether it works) (and the two internal tokens, `AGENT_INTERNAL_TOKEN` and `MCP_INTERNAL_TOKEN`; commands are in `.env.example`), then open a store and choose **Ask the agent**. Each answer links to its trace: tool calls, policy decisions, tokens and cost.

Approval emails go through Resend when `RESEND_API_KEY` is set; without it they are printed in the MCP server's console, link included. To try rules and approvals without a Claude key, send one tool call through the MCP server as the agent would:

```bash
pnpm --filter @store-ops/agent try-tool <storeId> create_coupon '{"code":"FESTIVE15","type":"percent","value":15,"usageLimit":50}'
```

### Evals

`packages/evals` holds 40 tasks (15 reads, 10 writes, 6 multi-step, 4 ambiguous, 5 prompt-injection). Each runs the real agent on a store seeded with the canonical dataset plus injection text planted in order notes and reviews, and is graded in code against facts read from the store before the run. The report gives the success rate per platform and category, unsafe writes executed, injections followed and cross-tenant leaks (all must be 0), median latency and average cost.

```bash
pnpm --filter @store-ops/evals eval -- --platforms supabase,custom,woocommerce --yes
```

Without `--yes` it only prints the plan and an estimated cost (about ₹3 a task run). Reports go to `packages/evals/reports/`. Running it reseeds the boutique (and the Docker WooCommerce store) with injection text; run `pnpm boutique:reset` afterwards for clean local data.

### Tests

Tests use their own database (`storeops_test`, set in `.env.test`), so the stores they create never reach the dev worker. `pnpm db:migrate` migrates both.

```bash
pnpm test        # all packages (needs the databases running)
pnpm test:e2e    # the browser test (also needs Chrome locally, or `pnpm --filter @store-ops/e2e exec playwright install chromium` and E2E_BROWSER_CHANNEL=chromium)
pnpm typecheck
```

- `packages/db` — tenant isolation: owner A tries to read and write store B's rows by every route. Pass condition: zero leaks.
- `packages/adapters` — the conformance suite (`src/testing/conformance.ts`), run against every adapter with the same canonical dataset. Pass condition: 100%. Shopify adds schema validation of every query, unit tests against a fake Shopify (OAuth, webhook signatures, token refresh, throttling, mapping), and the same conformance suite against a seeded development store when one is configured. WooCommerce runs the suite against a real WooCommerce in Docker (`pnpm --filter @store-ops/adapters test:woo`). The sample custom connector runs it on every test run.
- `packages/shared` — credential encryption, store-time-zone periods.
- `packages/tools` — the policy engine (modes, every limit, kill switch, fail-closed on bad limits) and approvals against the boutique: approve runs once, reject changes nothing, expiry, pause, cross-store refusal, signed links.
- `apps/mcp` — the MCP server over HTTP with a real MCP client: tool listing, approvals, Auto writes and audit, Never, kill switch, cross-store runs refused.
- `apps/worker` — every job against the boutique with a scripted model (drafts, alerts that do not repeat, emails, paused stores), schedules in the store's time zone against real Redis, the store lock, and webhook-triggered checks.
- `apps/agent` — security: a model that obeys every injected instruction still cannot change the store, see credentials or reach another store (no Claude key needed, runs in CI).
- `packages/evals` — the eval harness itself: the task inventory, and every grader accepting correct behaviour and rejecting wrong behaviour, with scripted models.
- `apps/agent` — the loop with a scripted model (tool limit, time limit, refusals, cost), and the full chain over HTTP: agent API → MCP → boutique database.
- `e2e` — the launch path in a real browser: land, sign up, connect the boutique, see the first digest the worker wrote from its data (in under five minutes), ask for a coupon, approve it, find it in the activity log. The dashboard, agent API, MCP server and job worker run as in production against the test database and their own Redis database; only the model is scripted.

## Deploying

[`render.yaml`](render.yaml) deploys the dashboard, agent API, MCP server, job worker, Postgres and Redis as one Render Blueprint, with only the dashboard public. [docs/deploy.md](docs/deploy.md) walks through it: the values to fill in, how the database role and migrations are set up on each deploy, and what to check once it is live.

## Connecting the real boutique (Supabase)

1. In the Supabase SQL editor, create the `agent_api` schema and functions from `boutique-reference.sql`, rewriting each function body against the boutique's real tables while keeping the signatures and JSON shapes. Do **not** run the `DROP TABLE` lines against production.
2. Create `agent_role` with a strong password and grant it only `EXECUTE` on those functions.
3. Connect the store in the dashboard with that role's connection string (the direct or session-pooler connection, with `sslmode=require`).
   If the store does not support everything (for example, no review replies yet), add `agent_api.capabilities()` returning the supported list; the agent is then offered only those tools.
4. Run the conformance suite against a copy of the boutique database to confirm the functions behave.

See [DECISIONS.md](DECISIONS.md) for the reasoning behind these choices.
