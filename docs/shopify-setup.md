# Shopify setup

What you need to connect Shopify stores and run the Shopify conformance suite. The code is in `packages/adapters/src/shopify/`; this page covers the accounts and settings only a person can create.

## 1. A public HTTPS address

Shopify redirects owners back to the app after they approve it, and sends webhooks to it, so the dashboard needs a public HTTPS URL. Locally, run a tunnel to port 3100 (for example `cloudflared tunnel --url http://localhost:3100` or `ngrok http 3100`) and put its address in `.env`:

```
APP_URL="https://your-tunnel.example"
```

Restart the dashboard after changing it.

## 2. The app

1. Create a Shopify Partner account at partners.shopify.com, then create an app in the Dev Dashboard.
2. Set:
   - **App URL**: `https://<APP_URL>/stores`
   - **Allowed redirection URL**: `https://<APP_URL>/api/shopify/callback`
   - **Embedded in Shopify admin**: off (the dashboard is a standalone site)
   - **Access scopes**: `read_orders, write_orders, read_products, read_inventory, write_inventory, read_locations, read_discounts, write_discounts, read_customers` (add `write_products` for a dev store you want to seed)
   - **Compliance webhooks** (customer data request, customer redact, shop redact): `https://<APP_URL>/api/webhooks/shopify`
   - **Protected customer data**: request access to customer name, email and phone. Orders return these fields only after it is granted.
3. Copy the client ID and secret into `.env`:

```
SHOPIFY_CLIENT_ID="..."
SHOPIFY_CLIENT_SECRET="..."
```

If you manage the app with the Shopify CLI, the same settings in `shopify.app.toml` look like this (check field names against the CLI version you use):

```toml
name = "Store Ops Agent"
client_id = "..."
application_url = "https://<APP_URL>/stores"
embedded = false

[access_scopes]
scopes = "read_orders,write_orders,read_products,read_inventory,write_inventory,read_locations,read_discounts,write_discounts,read_customers"

[auth]
redirect_urls = ["https://<APP_URL>/api/shopify/callback"]

[webhooks]
api_version = "2026-10"

  [[webhooks.subscriptions]]
  compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]
  uri = "https://<APP_URL>/api/webhooks/shopify"
```

## 3. Connect a store

In the dashboard choose **Connect a store → Shopify**, enter the `myshopify.com` address and approve the app on Shopify. The app receives expiring offline tokens (1 hour, refreshed automatically for 90 days) and subscribes to `orders/create`, `orders/updated`, `inventory_levels/update` and `app/uninstalled` when `APP_URL` is HTTPS.

## 4. A development store for conformance runs

1. In the Partner dashboard, create a **development store** that you use only for testing. The conformance suite expects the store to hold exactly the 50 products and 200 orders of the canonical dataset.
2. Set `SHOPIFY_EXTRA_SCOPES="write_products"` in `.env` and connect the dev store through the dashboard. Note its store id (the last part of its URL, `/stores/<id>`).
3. Seed it. Dev stores accept 5 new orders a minute, so the first run takes about 40 minutes; it can be stopped and re-run and picks up where it left off:

```bash
SHOPIFY_TEST_STORE_ID=<id> pnpm --filter @store-ops/adapters shopify:seed
```

4. Run the suite. It restores order tags, stock and coupons before each run, so it can be repeated:

```bash
SHOPIFY_TEST_STORE_ID=<id> pnpm --filter @store-ops/adapters test
```

Without `SHOPIFY_TEST_STORE_ID` (or `SHOPIFY_TEST_SHOP` and `SHOPIFY_TEST_ACCESS_TOKEN`), the Shopify conformance suite is skipped.

## Refreshing the API schema

Every GraphQL document the adapter sends is validated in CI against Shopify's Admin API schema for the pinned version (`src/shopify/version.ts`). When moving to a new version, update the constant and download its schema:

```bash
pnpm --filter @store-ops/adapters shopify:schema
```
