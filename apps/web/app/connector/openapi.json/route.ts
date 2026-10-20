import { buildConnectorSpec } from "@store-ops/adapters/custom-rest-spec";

/** The connector API spec, public so store developers can build against it. */
export function GET() {
  return Response.json(buildConnectorSpec(), { headers: { "cache-control": "public, max-age=3600" } });
}
