# Custom store connector

A store built in-house can work with the agent by implementing the **Store Ops connector API**: twelve JSON endpoints over HTTPS. The owner then connects it as a **Custom REST connector** with its base URL and an API key.

- **Spec (OpenAPI 3.1):** [`docs/connector/openapi.json`](connector/openapi.json), also served by the dashboard at `/connector/openapi.json`.
- **Sample implementation:** [`examples/custom-connector`](../examples/custom-connector/src/server.ts), a dependency-free Node server over an in-memory store. Replace its `Store` class with queries against your own tables.

## The contract in brief

| Endpoint | Purpose |
| --- | --- |
| `GET /capabilities` | What the store supports, e.g. `orders`, `orders.write`, `inventory`, `coupons`, `reviews` |
| `GET /orders`, `GET /orders/{id}` | Orders, newest first; filters `status`, `createdFrom`, `createdTo`, `overdue`, `query` |
| `POST /orders/{id}/status` | Change an order's status |
| `GET /products`, `GET /variants/{id}/product` | Products with variants; filters `query`, `lowStockThreshold` |
| `PUT /variants/{id}/stock` | Set a variant's absolute stock |
| `GET /coupons`, `POST /coupons` | List and create coupons |
| `GET /reviews`, `POST /reviews/{id}/reply` | Reviews and the store's one public reply |
| `GET /sales-summary?from&to` | Totals for orders created in `[from, to)` |

Conventions the platform checks:

- `Authorization: Bearer <API key>` on every request.
- Money is `{ "amount": <integer minor units>, "currency": "INR" }`; timestamps are UTC ISO 8601 with `Z`.
- Lists are paged with an opaque `cursor` and `nextCursor: null` on the last page; every item appears exactly once.
- Unsupported features answer `501` with `{ "error": { "code": "UNSUPPORTED", ... } }`; other errors use `NOT_FOUND` (404), `CONFLICT` (409), `VALIDATION` (422), `AUTH` (401), `RATE_LIMITED` (429 + `Retry-After`).
- Every response is validated against the spec's schemas; anything else is reported as an invalid response and the agent does not use it.

Version 1 has no webhooks: scheduled jobs poll the store instead.

## Checking an implementation

The sample passes the same conformance suite as the built-in adapters:

```bash
pnpm --filter @store-ops/example-connector test
```

To check your own implementation, load the canonical dataset into a test copy of your store and point `defineConformanceSuite` (in `packages/adapters/src/testing/conformance.ts`) at it with a `CustomRestAdapter`, as `examples/custom-connector/test/conformance.test.ts` does.

To run the sample locally and connect it from the dashboard:

```bash
CONNECTOR_API_KEY=local-sample-connector-key pnpm --filter @store-ops/example-connector start
```

Then connect `http://localhost:3300/store-ops/v1` with that key.
