/**
 * Runs the eval suite against the real agent (Claude) on each platform.
 *
 *   pnpm --filter @store-ops/evals eval -- --platforms supabase,custom [--tasks R01,W02] [--yes]
 *
 * It spends real money: it prints an estimate and waits for --yes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { anthropicModel } from "@store-ops/agent/anthropic-model";
import { connectMcpTools } from "@store-ops/agent/mcp-tools";
import { basePrisma } from "@store-ops/db";
import { createMcpHttpServer } from "@store-ops/mcp/http";
import { closeAdapters } from "@store-ops/mcp/server";
import { PLATFORM_NAMES, setupDecoy, setupPlatform, type PlatformName } from "./platforms";
import { renderMarkdown, summarise } from "./report";
import { runPlatform, type TaskResult } from "./runner";
import { TASKS, orderedTasks } from "./tasks";

const ESTIMATED_INR_PER_TASK = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const platforms = (arg("platforms") ?? "supabase,custom").split(",").map((p) => p.trim()) as PlatformName[];
const unknown = platforms.filter((p) => !(PLATFORM_NAMES as readonly string[]).includes(p));
if (unknown.length) throw new Error(`Unknown platform(s): ${unknown.join(", ")}. Use ${PLATFORM_NAMES.join(", ")}.`);
const taskIds = arg("tasks")?.split(",").map((t) => t.trim().toUpperCase());
const tasks = orderedTasks(taskIds);
if (!tasks.length) throw new Error(`No tasks match. Ids: ${TASKS.map((t) => t.id).join(", ")}`);
const model = process.env.AGENT_MODEL ?? "claude-opus-5-5";

const runs = tasks.length * platforms.length;
console.log(`${tasks.length} tasks × ${platforms.length} platform(s) = ${runs} agent runs on ${model}.`);
console.log(`Estimated cost: about ₹${runs * ESTIMATED_INR_PER_TASK} (₹${ESTIMATED_INR_PER_TASK} a run; the report gives the real figure).`);
if (!process.argv.includes("--yes")) {
  console.log("Nothing run. Add --yes to go ahead.");
  process.exit(0);
}

const token = `eval-${Date.now()}`.padEnd(40, "e");
const mcp = createMcpHttpServer({ token });
await new Promise<void>((resolve) => mcp.listen(0, "127.0.0.1", resolve));
process.env.MCP_URL = `http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`;
process.env.MCP_INTERNAL_TOKEN = token;

const deps = { model: anthropicModel({ model }), connectTools: connectMcpTools };
const decoy = await setupDecoy();
const results: TaskResult[] = [];
try {
  for (const name of platforms) {
    console.log(`\n${name}: setting up…`);
    const store = await setupPlatform(name);
    try {
      await runPlatform(store, tasks, deps, (r) => {
        results.push(r);
        const mark = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–";
        console.log(`  ${mark} ${r.taskId} ${r.title}${r.status === "fail" ? `: ${r.checks.filter((c) => !c.ok).map((c) => c.name).join("; ")}` : ""}`);
      });
    } finally {
      await store.close();
    }
  }
} finally {
  await decoy.close();
  mcp.close();
  await closeAdapters();
  await basePrisma().$disconnect();
}

const date = new Date().toISOString();
const dir = new URL("../reports/", import.meta.url);
mkdirSync(dir, { recursive: true });
const stamp = date.replace(/[:.]/g, "-");
writeFileSync(new URL(`eval-${stamp}.json`, dir), JSON.stringify({ date, model, summaries: summarise(results), results }, null, 2));
writeFileSync(new URL(`eval-${stamp}.md`, dir), renderMarkdown(results, { model, date }));
console.log(`\n${renderMarkdown(results, { model, date }).split("\n## Failures")[0]}`);
console.log(`Report: packages/evals/reports/eval-${stamp}.md`);
process.exit(0);
