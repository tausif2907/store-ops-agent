<?php
/**
 * Replaces the local test store's catalogue, orders, coupons and reviews with
 * the canonical dataset in /scripts/.dataset.json (written by the TypeScript
 * side). Local test store only: it deletes every product, order and coupon.
 *
 *   docker compose --profile woo run --rm woo-cli wp eval-file /scripts/seed.php
 */
$data = json_decode(file_get_contents('/scripts/.dataset.json'), true);
if (!$data) {
    WP_CLI::error('No dataset at /scripts/.dataset.json');
}

// Quiet: no emails, and no stock changes from order status transitions.
add_filter('pre_wp_mail', '__return_false');
add_filter('woocommerce_can_reduce_order_stock', '__return_false');
add_filter('woocommerce_can_restore_order_stock', '__return_false');

// ---- Wipe ----------------------------------------------------------------------
foreach (wc_get_orders(['limit' => -1, 'return' => 'ids', 'status' => array_keys(wc_get_order_statuses())]) as $id) {
    wc_get_order($id)->delete(true);
}
foreach (get_posts(['post_type' => ['product', 'product_variation', 'shop_coupon'], 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids']) as $id) {
    wp_delete_post($id, true);
}

// ---- Products ------------------------------------------------------------------
$productIds = [];
$variantIds = [];
foreach ($data['products'] as $p) {
    $product = new WC_Product_Variable();
    $product->set_name($p['title']);
    $product->set_slug('rts-' . $p['key']);
    $product->set_status($p['status'] === 'draft' ? 'draft' : 'publish');
    $attribute = new WC_Product_Attribute();
    $attribute->set_name('Size');
    $attribute->set_options(array_column($p['variants'], 'title'));
    $attribute->set_visible(true);
    $attribute->set_variation(true);
    $product->set_attributes([$attribute]);
    $product->save();
    foreach ($p['variants'] as $v) {
        $variation = new WC_Product_Variation();
        $variation->set_parent_id($product->get_id());
        $variation->set_attributes(['size' => $v['title']]);
        $variation->set_regular_price(number_format($v['pricePaise'] / 100, 2, '.', ''));
        $variation->set_sku($v['sku']);
        if ($v['stock'] === null) {
            $variation->set_manage_stock(false);
            $variation->set_stock_status('instock');
        } else {
            $variation->set_manage_stock(true);
            $variation->set_stock_quantity($v['stock']);
        }
        $variation->save();
        $variantIds[$v['key']] = $variation->get_id();
    }
    WC_Product_Variable::sync($product->get_id());
    $productIds[$p['key']] = $product->get_id();
}

// ---- Orders --------------------------------------------------------------------
$customers = array_column($data['customers'], null, 'key');
// Normalised status => [WooCommerce status, store_ops_status meta]
$statusMap = [
    'pending' => ['pending', ''],
    'processing' => ['processing', ''],
    'ready' => ['processing', 'ready'],
    'shipped' => ['completed', ''],
    'delivered' => ['completed', 'delivered'],
    'cancelled' => ['cancelled', ''],
    'refunded' => ['refunded', ''],
];
foreach ($data['orders'] as $o) {
    $order = wc_create_order(['status' => 'pending']);
    foreach ($o['items'] as $item) {
        $order->add_product(wc_get_product($variantIds[$item['variantKey']]), $item['quantity']);
    }
    $c = $customers[$o['customerKey']];
    [$first, $last] = array_pad(explode(' ', $c['name'], 2), 2, '');
    $order->set_billing_first_name($first);
    $order->set_billing_last_name($last);
    $order->set_billing_email($c['email']);
    $order->set_billing_phone($c['phone']);
    $order->set_customer_note($o['note'] ?? '');
    $order->set_currency('INR');
    $order->update_meta_data('_order_number', $o['number']);
    if ($o['promisedAt']) {
        $order->update_meta_data('store_ops_promised_at', $o['promisedAt']);
    }
    [$status, $opsStatus] = $statusMap[$o['status']];
    if ($opsStatus !== '') {
        $order->update_meta_data('store_ops_status', $opsStatus);
    }
    $order->calculate_totals(false);
    $order->set_status($status);
    $order->set_date_created(strtotime($o['createdAt']));
    $order->save();
}

// ---- Coupons -------------------------------------------------------------------
foreach ($data['coupons'] as $c) {
    $coupon = new WC_Coupon();
    $coupon->set_code($c['code']);
    $coupon->set_discount_type($c['type'] === 'percent' ? 'percent' : 'fixed_cart');
    $coupon->set_amount($c['type'] === 'percent' ? $c['value'] : $c['value'] / 100);
    $coupon->set_usage_limit($c['usageLimit'] ?? 0);
    $coupon->set_usage_count($c['usageCount']);
    // WooCommerce's REST API does not list draft coupons, so a switched-off
    // coupon is one that has expired.
    $expires = $c['endsAt'] ? strtotime($c['endsAt']) : null;
    if (!$c['active'] && ($expires === null || $expires > time())) {
        $expires = time() - DAY_IN_SECONDS;
    }
    if ($expires !== null) {
        $coupon->set_date_expires($expires);
    }
    $coupon->save();
}

// ---- Reviews and replies ---------------------------------------------------------
foreach ($data['reviews'] as $r) {
    $postId = $productIds[$r['productKey']];
    $gmt = gmdate('Y-m-d H:i:s', strtotime($r['createdAt']));
    $id = wp_insert_comment([
        'comment_post_ID' => $postId,
        'comment_author' => $r['author'],
        'comment_author_email' => 'reviewer@example.com',
        'comment_content' => $r['body'],
        'comment_type' => 'review',
        'comment_approved' => 1,
        'comment_date_gmt' => $gmt,
        'comment_date' => get_date_from_gmt($gmt),
    ]);
    update_comment_meta($id, 'rating', $r['rating']);
    if ($r['reply']) {
        // An owner's reply is a plain comment under the review, as in wp-admin.
        $replyGmt = gmdate('Y-m-d H:i:s', strtotime($r['createdAt']) + 60);
        wp_insert_comment([
            'comment_post_ID' => $postId,
            'comment_parent' => $id,
            'comment_author' => 'Rashmi Tailoring Studio',
            'comment_author_email' => 'admin@storeops.test',
            'comment_content' => $r['reply'],
            'comment_type' => 'comment',
            'comment_approved' => 1,
            'comment_date_gmt' => $replyGmt,
            'comment_date' => get_date_from_gmt($replyGmt),
            'user_id' => 1,
        ]);
    }
}
foreach ($productIds as $id) {
    WC_Comments::clear_transients($id);
}

WP_CLI::success(sprintf(
    'Seeded %d products, %d orders, %d coupons, %d reviews.',
    count($data['products']), count($data['orders']), count($data['coupons']), count($data['reviews'])
));
