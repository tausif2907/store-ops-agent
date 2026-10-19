import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import * as documents from "../src/shopify/queries";
import { SHOPIFY_API_VERSION } from "../src/shopify/version";

// Shopify's own schema has deprecation patterns graphql-js 17 rejects; we only
// validate our documents against it, so trust the schema itself.
const schema = buildSchema(
  readFileSync(new URL(`../src/shopify/admin-schema-${SHOPIFY_API_VERSION}.graphql`, import.meta.url), "utf8"),
  { assumeValid: true },
);

const queries = Object.entries(documents).filter(([, value]) => typeof value === "string" && /\b(query|mutation)\b/.test(value));

describe(`Shopify documents validate against the Admin API ${SHOPIFY_API_VERSION} schema`, () => {
  it("covers every document", () => {
    expect(queries.length).toBeGreaterThan(20);
  });

  it("catches a field Shopify does not have", () => {
    const errors = validate(schema, parse("query { shop { name primaryColour } }"));
    expect(errors.map((e) => e.message).join()).toMatch(/primaryColour/);
  });

  it.each(queries)("%s", (_name, source) => {
    const errors = validate(schema, parse(source as string));
    expect(errors.map((e) => e.message)).toEqual([]);
  });
});
