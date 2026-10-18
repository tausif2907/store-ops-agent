import Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "./loop";

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
