import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildDataset, promisedAtIso, type Dataset } from "../testing/dataset";

/**
 * Seeds the local Docker WooCommerce store (docker compose --profile woo)
 * with the canonical dataset. WooCommerce's REST API cannot backdate orders,
 * so seeding runs a PHP script through WP-CLI inside the stack.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function resetWooDockerStore(dataset: Dataset = buildDataset()): void {
  const json = {
    customers: dataset.customers,
    products: dataset.products,
    orders: dataset.orders.map((o) => ({
      ...o,
      createdAt: o.createdAt.toISOString(),
      promisedAt: o.promisedDate ? promisedAtIso(o.promisedDate) : null,
    })),
    coupons: dataset.coupons.map((c) => ({ ...c, startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null })),
    reviews: dataset.reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
  writeFileSync(`${REPO_ROOT}docker/woo/.dataset.json`, JSON.stringify(json));
  execFileSync("docker", ["compose", "--profile", "woo", "run", "--rm", "-T", "woo-cli", "wp", "eval-file", "/scripts/seed.php"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    timeout: 300_000,
  });
}
