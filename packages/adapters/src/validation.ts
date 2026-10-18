import type { z } from "zod";
import { AdapterError } from "./adapter";

/** Validates caller input, turning schema failures into AdapterError("VALIDATION"). */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AdapterError("VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}
