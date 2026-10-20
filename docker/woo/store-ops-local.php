<?php
/**
 * Local test store only.
 */

// Allow webhook deliveries to host.docker.internal (a private address
// WordPress refuses by default), so they reach the dashboard on the host.
add_filter('http_request_host_is_external', function ($external, $host) {
    return $external || $host === 'host.docker.internal';
}, 10, 2);

// ...and to its port (WordPress only allows 80, 443 and 8080 by default).
add_filter('http_allowed_safe_ports', function ($ports) {
    $ports[] = 3100;
    return $ports;
});

// Emulate a sequential order numbers plugin (common on real stores): the
// order number shown everywhere, including the REST API, comes from the
// _order_number meta, and order search covers it. The seeded dataset sets it
// to RTS-1001 and so on.
add_filter('woocommerce_order_number', function ($number, $order) {
    $custom = $order->get_meta('_order_number');
    return $custom !== '' ? $custom : $number;
}, 10, 2);

add_filter('woocommerce_shop_order_search_fields', function ($fields) {
    $fields[] = '_order_number';
    return $fields;
});
