import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./loop";

const KEYS_HINT = "Create a key in the Claude Console (console.anthropic.com) under Settings → API keys, and copy it whole: it is shown only once.";

/**
 * Checks that the Claude credentials work and can use the agent's model, so a
 * wrong key shows up in the service log at startup instead of as failed runs
 * later. Uses the Models API, which costs nothing.
 */
export async function checkClaudeAccess(options: { model?: string; client?: Pick<Anthropic, "models"> } = {}): Promise<{ ok: true; model: string } | { ok: false; message: string }> {
  const model = options.model ?? process.env.AGENT_MODEL ?? "claude-opus-5-5";
  try {
    await (options.client ?? new Anthropic()).models.retrieve(model);
    return { ok: true, model };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: `Claude rejected ANTHROPIC_API_KEY (401): it is mistyped, deleted, expired or from another workspace. ${KEYS_HINT}` };
    }
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, message: `This key may not use the Claude API (403). Check its workspace in the Claude Console.` };
    if (err instanceof Anthropic.NotFoundError) return { ok: false, message: `The model ${model} is not available to this key. Set AGENT_MODEL to one that is.` };
    // Client-side errors mean no request was made, most often because there are no credentials.
    if (err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError)) return { ok: false, message: `No Claude credentials: set ANTHROPIC_API_KEY. ${KEYS_HINT}` };
    return { ok: false, message: `Could not check the Claude key: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Claude via the Messages API, streamed. Uses server-side refusal fallbacks
 * (routed by the API per refusal category) so a declined request is retried
 * on a fallback model inside the same call.
 */
export function anthropicModel(options: {
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  client?: Anthropic;
} = {}): ModelClient {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? process.env.AGENT_MODEL ?? "claude-opus-5-5";
  const effort = options.effort ?? (process.env.AGENT_EFFORT as "medium" | undefined) ?? "medium";

  return {
    async turn({ system, messages, tools, toolChoice }, { signal, onText }) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 16_000,
          system,
          messages,
          tools,
          tool_choice: { type: toolChoice },
          output_config: { effort },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );
      stream.on("text", onText);
      return stream.finalMessage();
    },
  };
}
