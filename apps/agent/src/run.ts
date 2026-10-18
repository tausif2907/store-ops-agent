import Anthropic from "@anthropic-ai/sdk";
import { dbForStore } from "@store-ops/db";
import type { AgentEvent, ChatTurn } from "@store-ops/shared";
import { RunLimitError, runAgentLoop, type LoopLimits, type ModelClient, type ToolClient } from "./loop";
import { usdToInr } from "./pricing";
import { systemPrompt } from "./prompt";

export interface RunDeps {
  model: ModelClient;
  connectTools: (ctx: { storeId: string; runId: string }) => Promise<ToolClient & { close(): Promise<void> }>;
  limits?: Partial<LoopLimits>;
}

/**
 * One chat run, traced end to end: the run row, every tool call (recorded by
 * the MCP server), tokens, cost and the monthly usage counter.
 */
export async function runChat(
  input: { storeId: string; message: string; history: ChatTurn[]; signal?: AbortSignal },
  emit: (event: AgentEvent) => void,
  deps: RunDeps,
): Promise<string> {
  const db = dbForStore(input.storeId);
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new Error("Unknown store");

  const run = await db.agentRun.create({ data: { storeId: store.id, trigger: "CHAT", input: input.message } });
  emit({ type: "run", runId: run.id });

  if (store.isPaused) {
    const message = "This store is paused, so the agent is not running. Resume it from the store page.";
    await db.agentRun.update({ where: { id: run.id }, data: { status: "CANCELLED", error: message, finishedAt: new Date() } });
    emit({ type: "error", message });
    return run.id;
  }

  let tools: Awaited<ReturnType<RunDeps["connectTools"]>> | undefined;
  try {
    tools = await deps.connectTools({ storeId: store.id, runId: run.id });
    const result = await runAgentLoop({
      model: deps.model,
      tools,
      system: systemPrompt(store),
      history: input.history,
      message: input.message,
      emit,
      limits: deps.limits,
      signal: input.signal,
    });
    const tokensIn = result.tokens.input + result.tokens.cacheWrite + result.tokens.cacheRead;
    const costInr = usdToInr(result.costUsd);
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        output: result.output,
        tokensIn,
        tokensOut: result.tokens.output,
        costInr,
        finishedAt: new Date(),
      },
    });
    await recordUsage(store.id, tokensIn + result.tokens.output, costInr);
    emit({ type: "done", output: result.output, tokensIn, tokensOut: result.tokens.output, costInr, toolCalls: result.toolCalls });
  } catch (err) {
    const message = input.signal?.aborted ? "The run was cancelled." : describeError(err);
    if (!(err instanceof RunLimitError) && !input.signal?.aborted) console.error(`Run ${run.id} failed`, err);
    await db.agentRun.update({
      where: { id: run.id },
      data: { status: input.signal?.aborted ? "CANCELLED" : "FAILED", error: message, finishedAt: new Date() },
    });
    await recordUsage(store.id, 0, 0);
    emit({ type: "error", message });
  } finally {
    await tools?.close();
  }
  return run.id;
}

async function recordUsage(storeId: string, tokens: number, costInr: number) {
  const month = new Date().toISOString().slice(0, 7);
  await dbForStore(storeId).usage.upsert({
    where: { storeId_month: { storeId, month } },
    create: { storeId, month, runs: 1, tokens, costInr },
    update: { runs: { increment: 1 }, tokens: { increment: tokens }, costInr: { increment: costInr } },
  });
}

/** What the owner sees when a run fails. Details stay in the server log. */
function describeError(err: unknown): string {
  if (err instanceof RunLimitError) return err.message;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "The agent's Claude API key is missing or invalid.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a minute.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach Claude. Try again.";
  if (err instanceof Anthropic.APIError) return `Claude returned an error (${err.status ?? "unknown"}). Try again.`;
  // Client-side SDK errors (no request made), most often missing credentials.
  if (err instanceof Anthropic.AnthropicError) return "The agent is not configured: check its Claude API credentials.";
  return "The agent ran into an error.";
}
