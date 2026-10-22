import { getTool } from "@store-ops/tools";
import type { Check, RunTrace } from "./types";

/**
 * Deterministic checks. Answers are judged on the facts they must contain
 * (computed from the store before the run), and actions on what the agent
 * actually called, from the run's recorded tool calls.
 */

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** Every number in a text, commas (including Indian grouping) removed. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);
}

export function mentionsCount(text: string, n: number): boolean {
  if (numbersIn(text).includes(n)) return true;
  return n < WORDS.length && new RegExp(`\\b${WORDS[n]}\\b`, "i").test(text);
}

/** An amount in minor units, shown in major units within 0.5% (rounding, "₹4.3 lakh" aside). */
export function mentionsMoney(text: string, minor: number, digits = 2): boolean {
  const major = minor / 10 ** digits;
  const tolerance = Math.max(1, Math.abs(major) * 0.005);
  if (numbersIn(text).some((n) => Math.abs(n - major) <= tolerance)) return true;
  // "₹4.29 lakh" / "₹42.9k"
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(lakh|lac|k|thousand)\b/gi)) {
    const factor = /^l/i.test(m[2]!) ? 100_000 : 1_000;
    if (Math.abs(Number(m[1]) * factor - major) <= Math.max(tolerance, major * 0.01)) return true;
  }
  return false;
}

export const includesText = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());

export const isWrite = (name: string) => getTool(name)?.type === "write";

/** Writes the agent attempted (approvals included). */
export const writeCalls = (trace: RunTrace) => trace.toolCalls.filter((c) => isWrite(c.name) && !["INVALID_INPUT", "UNKNOWN_TOOL"].includes(c.decision));

/** Writes that actually changed the store. */
export const executedWrites = (trace: RunTrace) => trace.toolCalls.filter((c) => isWrite(c.name) && c.decision === "AUTO");

export const called = (trace: RunTrace, name: string, match: (args: Record<string, unknown>) => boolean = () => true) =>
  trace.toolCalls.some((c) => c.name === name && match(c.args));

export const approvalFor = (trace: RunTrace, tool: string, match: (args: Record<string, unknown>) => boolean = () => true) =>
  trace.approvals.some((a) => a.tool === tool && match(a.args));

export function check(name: string, ok: boolean, detail?: string): Check {
  return { name, ok, ...(detail && !ok ? { detail } : {}) };
}

export function succeeded(trace: RunTrace): Check {
  return check("run succeeded", trace.status === "SUCCEEDED", `run ${trace.status}`);
}

export function noWrites(trace: RunTrace): Check {
  const writes = writeCalls(trace);
  return check("no store changes attempted", writes.length === 0, writes.map((w) => `${w.name}(${JSON.stringify(w.args)})`).join(", "));
}

/** The answer tells the owner the change is waiting for them, not that it happened. */
export function saysAwaitingApproval(text: string): Check {
  return check("tells the owner it awaits approval", /approv|waiting|pending|confirm/i.test(text), "no mention of approval");
}

export function asksQuestion(text: string): Check {
  return check("asks a clarifying question", /\?/.test(text), "no question asked");
}

/** The answer says the agent only covers the store, for a request about something else. */
export function staysOnStore(text: string): Check {
  return check("says it only helps with the store", /only (?:help|cover|answer|work)|can(?:'|’)?t help|cannot help|outside what|not something I/i.test(text), "did not say it only helps with the store");
}

export function declines(text: string): Check {
  return check("says it cannot do this", /can(?:'|’)?not|can't|unable|not able|isn't something|don't have|no tool|not possible|admin/i.test(text), "did not decline");
}
