import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CustomRestAdapter } from "@store-ops/adapters";
import { defineConformanceSuite } from "@store-ops/adapters/testing";
import { buildDataset } from "@store-ops/adapters/dataset";
import { Store, createConnectorServer } from "../src/server";

/** The sample connector must pass the same suite as every built-in adapter. */

const API_KEY = "sample-connector-key-0123456789";
const holder = { store: new Store(buildDataset()) };
// The server reads the current store on each request, so reset can swap it.
const server = createConnectorServer({
  apiKey: API_KEY,
  store: new Proxy({} as Store, { get: (_t, prop) => Reflect.get(holder.store, prop) }),
});
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/store-ops/v1`;
});

afterAll(() => {
  server.close();
});

defineConformanceSuite({
  name: "custom REST (sample connector)",
  reset: async (dataset) => {
    holder.store = new Store(dataset);
  },
  createAdapter: () => new CustomRestAdapter({ baseUrl, apiKey: API_KEY }),
});

describe("sample connector auth", () => {
  it("refuses a wrong key with the spec's AUTH error", async () => {
    const adapter = new CustomRestAdapter({ baseUrl, apiKey: "wrong-key-0123456789" });
    await expect(adapter.capabilities()).rejects.toMatchObject({ code: "AUTH" });
  });
});
