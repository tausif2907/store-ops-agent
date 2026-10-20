/**
 * Runs the sample connector on http://localhost:3300/store-ops/v1 with the
 * canonical test dataset. Connect it in the dashboard as a "Custom REST
 * connector" with that URL and the API key below.
 *
 *   CONNECTOR_API_KEY=... pnpm --filter @store-ops/example-connector start
 */
import { buildDataset } from "@store-ops/adapters/dataset";
import { Store, createConnectorServer } from "./server";

const apiKey = process.env.CONNECTOR_API_KEY;
if (!apiKey || apiKey.length < 16) throw new Error("Set CONNECTOR_API_KEY to at least 16 characters");
const port = Number(process.env.CONNECTOR_PORT ?? 3300);

createConnectorServer({ apiKey, store: new Store(buildDataset()) }).listen(port, () => {
  console.log(`Sample connector on http://localhost:${port}/store-ops/v1`);
});
