import type { Platform } from "@store-ops/shared";
import { Icon, type IconName } from "./site/icons";

const ICONS: Record<Platform, { icon: IconName; tone: string }> = {
  SHOPIFY: { icon: "bag", tone: "from-green-600 to-emerald-500" },
  WOOCOMMERCE: { icon: "box", tone: "from-teal-600 to-cyan-500" },
  SUPABASE: { icon: "database", tone: "from-emerald-600 to-teal-500" },
  CUSTOM_REST: { icon: "code", tone: "from-slate-800 to-slate-600" },
};

/** A coloured tile marking a store's platform. */
export function PlatformIcon({ platform, size = "md" }: { platform: Platform; size?: "md" | "lg" }) {
  const { icon, tone } = ICONS[platform];
  const box = size === "lg" ? "h-12 w-12 rounded-xl" : "h-10 w-10 rounded-lg";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-sm ${tone} ${box}`} aria-hidden>
      <Icon name={icon} className={size === "lg" ? "h-6 w-6" : "h-5 w-5"} />
    </span>
  );
}
