/**
 * Downloads Shopify's Admin GraphQL schema for the API version the adapter
 * uses, as SDL. Tests validate every adapter query against it.
 *
 *   pnpm --filter @store-ops/adapters shopify:schema
 */
import { writeFile } from "node:fs/promises";
import { buildClientSchema, getIntrospectionQuery, printSchema, type IntrospectionQuery } from "graphql";
import { SHOPIFY_API_VERSION } from "../src/shopify/version";

const res = await fetch(`https://shopify.dev/admin-graphql-direct-proxy/${SHOPIFY_API_VERSION}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: getIntrospectionQuery() }),
});
if (!res.ok) throw new Error(`Schema download failed: ${res.status}`);
const { data } = (await res.json()) as { data: IntrospectionQuery };
const sdl = printSchema(buildClientSchema(data));
const out = new URL(`../src/shopify/admin-schema-${SHOPIFY_API_VERSION}.graphql`, import.meta.url);
await writeFile(out, sdl);
console.log(`Saved ${Math.round(sdl.length / 1024)} KB to ${out.pathname}`);
