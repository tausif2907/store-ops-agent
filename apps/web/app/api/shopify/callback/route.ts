import { NextResponse, type NextRequest } from "next/server";
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
  return NextResponse.redirect(new URL(`/stores/${result.storeId}`, req.url));
}
