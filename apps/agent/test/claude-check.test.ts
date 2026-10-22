import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkClaudeAccess } from "../src/anthropic-model";

/** A client whose model lookup answers with the given HTTP status. */
function clientAnswering(status: number | null) {
  return {
    models: {
      retrieve: async () => {
        if (status === null) return {};
        throw Anthropic.APIError.generate(status, { error: { type: "error", message: "no" } }, "no", new Headers());
      },
    },
  } as unknown as Pick<Anthropic, "models">;
}

describe("startup check of the Claude key", () => {
  it("passes when the key can use the model", async () => {
    expect(await checkClaudeAccess({ model: "claude-opus-5-5", client: clientAnswering(null) })).toEqual({ ok: true, model: "claude-opus-5-5" });
  });

  it("explains a rejected key and an unavailable model", async () => {
    const rejected = await checkClaudeAccess({ client: clientAnswering(401) });
    expect(!rejected.ok && rejected.message).toMatch(/rejected ANTHROPIC_API_KEY \(401\): it is mistyped, deleted, expired.*Settings → API keys/);
    const missing = await checkClaudeAccess({ model: "claude-nope", client: clientAnswering(404) });
    expect(!missing.ok && missing.message).toMatch(/claude-nope is not available/);
  });
});
