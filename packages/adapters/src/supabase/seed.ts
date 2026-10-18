import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { OrderStatus } from "@store-ops/shared";
import { buildDataset, orderTotalPaise, variantOf, type Dataset } from "../testing/dataset";

const BOUTIQUE_STATUS: Record<OrderStatus, string> = {
  pending: "placed",
  processing: "stitching",
  ready: "ready",
  shipped: "dispatched",
  delivered: "delivered",
  cancelled: "cancelled",
  refunded: "refunded",
};

/**
 * Recreates the boutique reference schema and agent API, then loads the
 * canonical dataset. Connects as the database owner, never as agent_role.
 */
export async function resetBoutique(adminUrl: string, dataset: Dataset = buildDataset()): Promise<void> {
  const sql = await readFile(fileURLToPath(new URL("./boutique-reference.sql", import.meta.url)), "utf8");
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);

    const ids = new Map<string, string>();
    const idFor = (key: string) => {
      let id = ids.get(key);
      if (!id) ids.set(key, (id = randomUUID()));
      return id;
    };

    for (const c of dataset.customers) {
      await client.query("INSERT INTO customers (id, name, email, phone) VALUES ($1, $2, $3, $4)", [
        idFor(c.key), c.name, c.email, c.phone,
      ]);
    }
    for (const p of dataset.products) {
      await client.query("INSERT INTO products (id, title, status) VALUES ($1, $2, $3)", [idFor(p.key), p.title, p.status]);
      for (const [position, v] of p.variants.entries()) {
        await client.query(
          "INSERT INTO product_variants (id, product_id, title, sku, price_paise, stock, position) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [idFor(v.key), idFor(p.key), v.title, v.sku, v.pricePaise, v.stock, position],
        );
      }
    }
    for (const o of dataset.orders) {
      await client.query(
        `INSERT INTO orders (id, order_number, customer_id, status, total_paise, note, promised_date, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [idFor(o.key), o.number, idFor(o.customerKey), BOUTIQUE_STATUS[o.status], orderTotalPaise(dataset, o), o.note, o.promisedDate, o.createdAt],
      );
      for (const item of o.items) {
        const product = dataset.products.find((p) => p.key === item.productKey)!;
        const variant = variantOf(dataset, item.productKey, item.variantKey);
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, title, quantity, unit_price_paise)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [idFor(o.key), idFor(item.productKey), idFor(item.variantKey), `${product.title} (${variant.title})`, item.quantity, variant.pricePaise],
        );
      }
    }
    for (const c of dataset.coupons) {
      await client.query(
        `INSERT INTO coupons (code, discount_type, discount_value, usage_count, usage_limit, starts_at, ends_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [c.code, c.type, c.value, c.usageCount, c.usageLimit, c.startsAt, c.endsAt, c.active],
      );
    }
    for (const r of dataset.reviews) {
      await client.query(
        `INSERT INTO reviews (id, product_id, order_id, rating, title, body, author_name, created_at, reply_body, replied_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [idFor(r.key), idFor(r.productKey), r.orderKey ? idFor(r.orderKey) : null, r.rating, r.title, r.body, r.author,
         r.createdAt, r.reply, r.reply ? r.createdAt : null],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}
