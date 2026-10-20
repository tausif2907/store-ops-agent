import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildConnectorSpec } from "../src/custom-rest/spec";

const spec = buildConnectorSpec() as {
  openapi: string;
  paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>>;
  components: { schemas: Record<string, unknown> };
};

describe("connector OpenAPI spec", () => {
  it("is OpenAPI 3.1 with unique operation ids", () => {
    expect(spec.openapi).toBe("3.1.0");
    const ids = Object.values(spec.paths).flatMap((ops) => Object.values(ops).map((op) => op.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(12);
  });

  it("only references schemas it defines", () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);
    for (const name of refs) expect(spec.components.schemas).toHaveProperty(name);
  });

  it("describes money in minor units and UTC timestamps", () => {
    const order = JSON.stringify(spec.components.schemas.Order);
    expect(order).toContain('"format":"date-time"');
    expect(JSON.stringify(spec.components.schemas.Order)).toMatch(/"amount":\{"type":"integer"/);
  });

  it("matches the published copy in docs/connector/openapi.json", () => {
    const published = JSON.parse(readFileSync(new URL("../../../docs/connector/openapi.json", import.meta.url), "utf8"));
    expect(published).toEqual(JSON.parse(JSON.stringify(spec)));
  });
});
