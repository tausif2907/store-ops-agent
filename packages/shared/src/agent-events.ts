/**
 * Events the agent API streams (as server-sent events) while a run executes.
 * The dashboard renders them as they arrive.
 */
export type AgentEvent =
  | { type: "run"; runId: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; isError: boolean; status: "ok" | "pending_approval" | "error" }
  | { type: "done"; output: string; tokensIn: number; tokensOut: number; costInr: number; toolCalls: number }
  | { type: "error"; message: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
