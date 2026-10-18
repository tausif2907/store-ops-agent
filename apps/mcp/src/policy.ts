import type { PolicyMode, ToolDefinition } from "./catalog";

/**
 * Decides whether a tool call runs. Phase 2 covers modes and the kill switch;
 * per-action limits (e.g. coupons up to 10%) arrive with the full policy
 * engine in Phase 3.
 */

export type Decision =
  | { outcome: "RUN"; mode: "AUTO" }
  | { outcome: "APPROVAL"; mode: "ASK" }
  | { outcome: "DENY"; mode: PolicyMode | "PAUSED"; reason: string };

export interface PolicyInput {
  tool: ToolDefinition;
  /** The store's own setting for this tool, if any. */
  storeMode: PolicyMode | undefined;
  storePaused: boolean;
}

export function effectiveMode(tool: ToolDefinition, storeMode: PolicyMode | undefined): PolicyMode {
  // Reads and drafts cannot be put behind approval, but they can be turned off.
  if (tool.type !== "write" && storeMode === "ASK") return "AUTO";
  return storeMode ?? tool.defaultMode;
}

export function decide({ tool, storeMode, storePaused }: PolicyInput): Decision {
  const mode = effectiveMode(tool, storeMode);
  if (mode === "NEVER") return { outcome: "DENY", mode, reason: `The owner has turned off ${tool.name} for this store.` };
  if (storePaused && tool.type === "write") {
    return { outcome: "DENY", mode: "PAUSED", reason: "The store is paused, so no changes can be made." };
  }
  return mode === "AUTO" ? { outcome: "RUN", mode } : { outcome: "APPROVAL", mode };
}
