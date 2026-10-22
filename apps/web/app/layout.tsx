import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import { NavProgress } from "@/components/nav-progress";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Store Ops Agent: an AI that runs your store, within your rules", template: "%s · Store Ops Agent" },
  description:
    "Answers questions about orders, stock and sales, sends a morning digest, drafts customer messages and proposes changes for your approval. For Shopify, WooCommerce and custom stores.",
  openGraph: { siteName: "Store Ops Agent", type: "website" },
};

/** The public site and the dashboard each add their own header and footer: see (site) and (app). */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
