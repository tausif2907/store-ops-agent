import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, ChatTurn } from "@store-ops/shared";
import { addUsage, costUsd, emptyTotals, type TokenTotals } from "./pricing";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Message = Anthropic.Beta.BetaMessage;
type Tool = Anthropic.Beta.BetaTool;
type TextBlockParam = Anthropic.Beta.BetaTextBlockParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;

/** One model call. The Anthropic implementation streams; tests use a fake. */
export interface ModelClient {
  turn(
    request: { system: TextBlockParam[]; messages: MessageParam[]; tools: Tool[]; toolChoice: "auto" | "none" },
    options: { signal: AbortSignal; onText: (delta: string) => void },
  ): Promise<Message>;
}

/** The store's tools, served by the MCP server for this run. */
export interface ToolClient {
  list(): Promise<Tool[]>;
  call(name: string, input: unknown): Promise<{ text: string; isError: boolean }>;
}

export interface LoopLimits {
  /** Maximum tool calls in one run. */
  maxToolCalls: number;
  /** Wall-clock limit for the whole run, in milliseconds. */
  timeLimitMs: number;
  /** Safety net on model calls, in case the model keeps going without tools. */
  maxTurns: number;
}

export const DEFAULT_LIMITS: LoopLimits = { maxToolCalls: 8, timeLimitMs: 60_000, maxTurns: 12 };

export interface LoopResult {
  output: string;
  tokens: TokenTotals;
  costUsd: number;
  toolCalls: number;
  stopReason: string;
}

export class RunLimitError extends Error {}

function isPendingApproval(text: string): boolean {
  try {
    return (JSON.parse(text) as { status?: unknown }).status === "pending_approval";
  } catch {
    return false;
  }
}

export async function runAgentLoop(args: {
  model: ModelClient;
  tools: ToolClient;
  system: TextBlockParam[];
  history: ChatTurn[];
  message: string;
  emit: (event: AgentEvent) => void;
  limits?: Partial<LoopLimits>;
  /** Aborts the run, e.g. when the owner closes the chat. */
  signal?: AbortSignal;
}): Promise<LoopResult> {
  const limits = { ...DEFAULT_LIMITS, ...args.limits };
  const deadline = AbortSignal.timeout(limits.timeLimitMs);
  const signal = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline;

  const tools = await args.tools.list();
  const messages: MessageParam[] = [
    ...args.history.map((t): MessageParam => ({ role: t.role, content: t.content })),
    { role: "user", content: args.message },
  ];
  const outputParts: string[] = [];
  let tokens = emptyTotals();
  let cost = 0;
  let toolCalls = 0;

  for (let turn = 0; turn < limits.maxTurns; turn++) {
    let message: Message;
    try {
      message = await args.model.turn(
        { system: args.system, messages, tools, toolChoice: toolCalls >= limits.maxToolCalls ? "none" : "auto" },
        { signal, onText: (delta) => args.emit({ type: "text", delta }) },
      );
    } catch (err) {
      if (deadline.aborted) throw new RunLimitError(`The run hit its ${Math.round(limits.timeLimitMs / 1000)}-second time limit.`);
      throw err;
    }
    tokens = addUsage(tokens, message.usage);
    cost += costUsd(message.model, message.usage);

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) outputParts.push(text);

    if (message.stop_reason === "refusal") {
      const apology = "I can't help with that request.";
      args.emit({ type: "text", delta: apology });
      outputParts.push(apology);
      return { output: outputParts.join("\n\n"), tokens, costUsd: cost, toolCalls, stopReason: "refusal" };
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    const toolUses = message.content.filter((b): b is ToolUse => b.type === "tool_use");
    if (toolUses.length === 0) {
      return { output: outputParts.join("\n\n"), tokens, costUsd: cost, toolCalls, stopReason: message.stop_reason ?? "end_turn" };
    }
    if (message.stop_reason === "max_tokens") throw new RunLimitError("The response was cut off before a tool call finished.");

    messages.push({ role: "assistant", content: message.content });
    const results: ToolResult[] = [];
    for (const use of toolUses) {
      if (toolCalls >= limits.maxToolCalls) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: `Tool limit reached for this run (${limits.maxToolCalls} calls). Answer with what you have.`,
        });
        continue;
      }
      toolCalls++;
      args.emit({ type: "tool_call", id: use.id, name: use.name, input: use.input });
      const result = await args.tools.call(use.name, use.input);
      const pending = !result.isError && isPendingApproval(result.text);
      args.emit({
        type: "tool_result",
        id: use.id,
        name: use.name,
        isError: result.isError,
        status: result.isError ? "error" : pending ? "pending_approval" : "ok",
      });
      results.push({ type: "tool_result", tool_use_id: use.id, is_error: result.isError || undefined, content: result.text });
    }
    // All results go back in one user message, so parallel tool calls keep working.
    messages.push({ role: "user", content: results });
  }
  throw new RunLimitError(`The run stopped after ${limits.maxTurns} model turns.`);
}
