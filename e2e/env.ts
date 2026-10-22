/**
 * Where the browser test's services listen. Ports sit next to the dev ones
 * (3100–3201) so a running `pnpm dev` is left alone, and jobs go to their own
 * Redis database so the dev worker never picks them up.
 */
const redisBase = (process.env.REDIS_URL ?? "redis://127.0.0.1:6380").replace(/\/\d*$/, "");

export const WEB_URL = "http://127.0.0.1:3110";

export const E2E_ENV: Record<string, string> = {
  APP_URL: WEB_URL,
  AGENT_URL: "http://127.0.0.1:3210",
  AGENT_INTERNAL_TOKEN: "e2e-agent-token-".padEnd(40, "a"),
  MCP_URL: "http://127.0.0.1:3211/mcp",
  MCP_INTERNAL_TOKEN: "e2e-mcp-token-".padEnd(40, "m"),
  REDIS_URL: `${redisBase}/1`,
  // Emails are printed by the stack, never sent.
  RESEND_API_KEY: "",
  NEXT_DIST_DIR: ".next-e2e",
};
