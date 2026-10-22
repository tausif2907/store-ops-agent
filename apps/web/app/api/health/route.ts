import { basePrisma } from "@store-ops/db";

/** For the host's health checks: the dashboard is up and can reach its database. */
export async function GET() {
  try {
    await basePrisma().$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
}
