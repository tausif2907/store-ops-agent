import { resetBoutique } from "../src/supabase/seed";
import { DATASET_COUNTS } from "../src/testing/dataset";

const url = process.env.BOUTIQUE_ADMIN_URL;
if (!url) throw new Error("BOUTIQUE_ADMIN_URL is not set");

await resetBoutique(url);
console.log(
  `Boutique reset: ${DATASET_COUNTS.products} products, ${DATASET_COUNTS.orders} orders, ` +
    `${DATASET_COUNTS.coupons} coupons, ${DATASET_COUNTS.reviews} reviews.`,
);
