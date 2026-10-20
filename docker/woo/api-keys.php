<?php
// Creates (once) a read/write WooCommerce REST API key for the admin user and
// prints it. Keys are stored hashed by WooCommerce; the secret is shown once,
// so it is also kept in an option for re-runs of this local-only script.
global $wpdb;
$saved = get_option('store_ops_test_api_key');
if (!$saved) {
    $key = 'ck_' . wc_rand_hash();
    $secret = 'cs_' . wc_rand_hash();
    $wpdb->insert($wpdb->prefix . 'woocommerce_api_keys', [
        'user_id' => 1,
        'description' => 'Store Ops Agent (local test)',
        'permissions' => 'read_write',
        'consumer_key' => wc_api_hash($key),
        'consumer_secret' => $secret,
        'truncated_key' => substr($key, -7),
    ]);
    $saved = ['key' => $key, 'secret' => $secret];
    update_option('store_ops_test_api_key', $saved, false);
}
echo "WOO_TEST_URL=\"http://localhost:8080\"\n";
echo "WOO_TEST_KEY=\"{$saved['key']}\"\n";
echo "WOO_TEST_SECRET=\"{$saved['secret']}\"\n";
