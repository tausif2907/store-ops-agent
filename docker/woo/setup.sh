#!/bin/sh
# Installs WordPress + WooCommerce for the local test store and prints REST API
# keys. Safe to re-run. Run with:
#   docker compose --profile woo run --rm woo-cli sh /scripts/setup.sh
set -eu
cd /var/www/html

# The wordpress container copies core files on first start; wait for them.
for i in $(seq 1 60); do [ -f wp-config.php ] && break; sleep 2; done

if ! wp core is-installed 2>/dev/null; then
  wp core install --url="http://localhost:8080" --title="Rashmi Test Store" \
    --admin_user=admin --admin_password=admin-local-only --admin_email=admin@storeops.test --skip-email
fi

wp plugin is-installed woocommerce || wp plugin install woocommerce
wp plugin is-active woocommerce || wp plugin activate woocommerce

wp rewrite structure '/%postname%/' --hard
wp option update timezone_string Asia/Kolkata
wp option update woocommerce_currency INR
wp option update woocommerce_default_country IN:KA
wp option update woocommerce_calc_taxes no
wp option update woocommerce_manage_stock yes
wp option update woocommerce_enable_reviews yes
wp option update woocommerce_coming_soon no
# Classic (posts) order storage, so order search covers the order-number meta
# that store-ops-local.php adds. Must be set before any order exists.
wp option update woocommerce_custom_orders_table_enabled no
wp option update woocommerce_custom_orders_table_data_sync_enabled no

# Local only: let webhooks reach the dashboard on the host (WordPress blocks
# private addresses by default), and emulate a sequential order numbers plugin.
mkdir -p wp-content/mu-plugins
cp /scripts/store-ops-local.php wp-content/mu-plugins/store-ops-local.php

# REST API keys for the adapter (read/write), created once.
wp eval-file /scripts/api-keys.php
