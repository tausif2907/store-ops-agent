/**
 * Writes the connector API's OpenAPI document to docs/connector/openapi.json.
 *   pnpm --filter @store-ops/adapters connector:spec
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildConnectorSpec } from "../src/custom-rest/spec";

const dir = new URL("../../../docs/connector/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("openapi.json", dir), `${JSON.stringify(buildConnectorSpec(), null, 2)}\n`);
console.log("Wrote docs/connector/openapi.json");
