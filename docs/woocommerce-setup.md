# WooCommerce setup

## Connecting a store

1. In WordPress: **WooCommerce → Settings → Advanced → REST API → Add key**, with **Read/Write** permission.
2. In the dashboard: **Connect a store → WooCommerce**, with the store's address and the consumer key and secret.

The connection is tested before anything is saved; the keys are stored encrypted. Over HTTPS the adapter uses HTTP Basic auth; over plain HTTP, WooCommerce requires signed OAuth 1.0a requests, which the adapter sends instead.

The agent can read orders, products and stock, coupons and reviews, change order status (not cancel or refund), set stock and create coupons. WooCommerce's API cannot post review replies, so replies stay in wp-admin; replies made there are shown to the agent.

Workflow states WooCommerce has no status for are kept in order meta: `store_ops_status` (`ready` while an order is "processing"; `delivered` once "completed"), and the promised delivery date in `store_ops_promised_at`.

## Webhooks

On connect, the adapter subscribes `order.created`, `order.updated` and `product.updated` to `<WEBHOOK_BASE_URL or APP_URL>/api/webhooks/woocommerce/<store id>`, with a signing secret it creates and stores with the keys. Deliveries with a missing or wrong `X-WC-Webhook-Signature` are refused.

WooCommerce delivers webhooks in the background (Action Scheduler, driven by site traffic or WP-Cron), so they can arrive a little after the change.

## The local test store (Docker)

A WordPress + WooCommerce store for development and the conformance suite.

```bash
docker compose --profile woo up -d
```

```bash
docker compose --profile woo run --rm woo-cli sh /scripts/setup.sh
```

`setup.sh` installs WordPress and WooCommerce at http://localhost:8080 (admin user `admin`, password `admin-local-only`) and prints `WOO_TEST_URL`, `WOO_TEST_KEY` and `WOO_TEST_SECRET`; put them in `.env`. On Windows Git Bash, prefix docker commands that pass container paths with `MSYS_NO_PATHCONV=1`.

The local store is set up to resemble a typical live one:

- `docker/woo/store-ops-local.php` (a must-use plugin) emulates a sequential order numbers plugin, so orders carry numbers like `RTS-1001` and order search finds them;
- it lets webhooks reach the dashboard on the host (`WEBHOOK_BASE_URL="http://host.docker.internal:3100"`).

Seed it with the canonical dataset (replaces all products, orders, coupons and reviews; takes a few minutes):

```bash
pnpm --filter @store-ops/adapters woo:seed
```

Run the conformance suite against it (reseeds first):

```bash
pnpm --filter @store-ops/adapters test:woo
```
