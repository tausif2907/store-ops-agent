import { NextResponse, type NextRequest } from "next/server";
import { welcomeUrl } from "@/lib/onboarding";
import { finishShopifyInstall } from "@/lib/shopify";
import { getSessionUser } from "@/lib/session";

/** Shopify redirects here after the owner approves the app. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const result = await finishShopifyInstall(user.id, req.nextUrl.searchParams);
  if ("error" in result) {
    const back = new URL("/stores/new", req.url);
    back.searchParams.set("platform", "SHOPIFY");
    back.searchParams.set("error", result.error);
    return NextResponse.redirect(back);
  }
  // A new store gets its first digest and the welcome page; a reconnected one goes back to its overview.
  return NextResponse.redirect(new URL(result.isNew ? await welcomeUrl(result.storeId) : `/stores/${result.storeId}`, req.url));
}
