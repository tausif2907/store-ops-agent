/**
 * Every GraphQL document the Shopify adapter and seeder send. Tests validate
 * each one against the Admin API schema for SHOPIFY_API_VERSION, so a field
 * renamed or removed by Shopify fails CI instead of failing in a store.
 */

export const METAFIELD_NAMESPACE = "store_ops";
/** Order tags that carry workflow states Shopify has no field for. */
export const PROCESSING_TAG = "ops-processing";
export const READY_TAG = "ops-ready";

const MONEY = `amount currencyCode`;

const ORDER_FIELDS = /* GraphQL */ `
  fragment OrderFields on Order {
    id
    name
    processedAt
    updatedAt
    cancelledAt
    note
    tags
    email
    phone
    displayFinancialStatus
    displayFulfillmentStatus
    totalPriceSet { shopMoney { ${MONEY} } }
    customer {
      id
      displayName
      defaultEmailAddress { emailAddress }
      defaultPhoneNumber { phoneNumber }
    }
    promisedAt: metafield(namespace: "${METAFIELD_NAMESPACE}", key: "promised_at") { value }
    fulfillments(first: 10) { id displayStatus }
    lineItems(first: 100) {
      nodes {
        title
        quantity
        originalUnitPriceSet { shopMoney { ${MONEY} } }
        product { id }
        variant { id }
      }
    }
  }
`;

const PRODUCT_FIELDS = /* GraphQL */ `
  fragment ProductFields on Product {
    id
    title
    status
    updatedAt
    variants(first: 100) {
      nodes {
        id
        title
        sku
        price
        inventoryQuantity
        inventoryItem { id tracked }
      }
    }
  }
`;

const DISCOUNT_FIELDS = /* GraphQL */ `
  fragment DiscountFields on DiscountCodeBasic {
    title
    status
    startsAt
    endsAt
    usageLimit
    asyncUsageCount
    codes(first: 1) { nodes { code } }
    customerGets {
      value {
        __typename
        ... on DiscountPercentage { percentage }
        ... on DiscountAmount { amount { ${MONEY} } appliesOnEachItem }
      }
    }
  }
`;

export const SHOP = /* GraphQL */ `
  query Shop {
    shop { id name currencyCode ianaTimezone myshopifyDomain }
  }
`;

export const ORDERS = /* GraphQL */ `
  ${ORDER_FIELDS}
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      edges { cursor node { ...OrderFields } }
      pageInfo { hasNextPage }
    }
  }
`;

export const ORDER = /* GraphQL */ `
  ${ORDER_FIELDS}
  query Order($id: ID!) {
    order(id: $id) { ...OrderFields }
  }
`;

export const ORDER_FULFILLMENT_ORDERS = /* GraphQL */ `
  query OrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 20) { nodes { id status } }
    }
  }
`;

export const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

export const TAGS_REMOVE = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
  }
`;

export const FULFILLMENT_CREATE = /* GraphQL */ `
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id }
      userErrors { field message }
    }
  }
`;

export const FULFILLMENT_EVENT_CREATE = /* GraphQL */ `
  mutation FulfillmentEventCreate($event: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $event) { userErrors { field message } }
  }
`;

export const PRODUCTS = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: ID) {
      edges { cursor node { ...ProductFields } }
      pageInfo { hasNextPage }
    }
  }
`;

export const VARIANT_PRODUCT = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query VariantProduct($id: ID!) {
    productVariant(id: $id) { product { ...ProductFields } }
  }
`;

export const VARIANT_INVENTORY = /* GraphQL */ `
  query VariantInventory($id: ID!) {
    productVariant(id: $id) {
      id
      inventoryQuantity
      inventoryItem {
        id
        tracked
        inventoryLevels(first: 20) {
          nodes {
            location { id isActive }
            quantities(names: ["available"]) { name quantity }
          }
        }
      }
    }
  }
`;

export const INVENTORY_SET = /* GraphQL */ `
  mutation InventorySet($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) {
      userErrors { code field message }
    }
  }
`;

export const DISCOUNTS = /* GraphQL */ `
  ${DISCOUNT_FIELDS}
  query Discounts($first: Int!, $after: String) {
    discountNodes(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        discount { __typename ...DiscountFields }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const DISCOUNT_CREATE = /* GraphQL */ `
  ${DISCOUNT_FIELDS}
  mutation DiscountCreate($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id codeDiscount { __typename ...DiscountFields } }
      userErrors { code field message }
    }
  }
`;

export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $uri: String!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: { uri: $uri, format: JSON }) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

export const WEBHOOKS = /* GraphQL */ `
  query Webhooks($uri: String!) {
    webhookSubscriptions(first: 50, uri: $uri) { nodes { id topic uri } }
  }
`;

// ---- Seeding a development store ---------------------------------------------

export const LOCATIONS = /* GraphQL */ `
  query Locations {
    locations(first: 10) { nodes { id isActive } }
  }
`;

export const PRODUCT_SET = /* GraphQL */ `
  mutation ProductSet($input: ProductSetInput!, $handle: String!) {
    productSet(input: $input, synchronous: true, identifier: { handle: $handle }) {
      product { id variants(first: 20) { nodes { id sku } } }
      userErrors { field message }
    }
  }
`;

export const ORDER_CREATE = /* GraphQL */ `
  mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id }
      userErrors { code field message }
    }
  }
`;

export const ORDER_CANCEL = /* GraphQL */ `
  mutation OrderCancel($id: ID!) {
    orderCancel(orderId: $id, restock: false, reason: OTHER, notifyCustomer: false) {
      orderCancelUserErrors { code field message }
    }
  }
`;

export const DISCOUNT_DELETE = /* GraphQL */ `
  mutation DiscountDelete($id: ID!) {
    discountCodeDelete(id: $id) { userErrors { field message } }
  }
`;

export const DISCOUNT_DEACTIVATE = /* GraphQL */ `
  mutation DiscountDeactivate($id: ID!) {
    discountCodeDeactivate(id: $id) { userErrors { field message } }
  }
`;

export const METAFIELDS_SET = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }
`;

export const SHOP_METAFIELD = /* GraphQL */ `
  query ShopMetafield($key: String!) {
    shop { id metafield(namespace: "${METAFIELD_NAMESPACE}", key: $key) { value } }
  }
`;

export const ORDERS_COUNT = /* GraphQL */ `
  query OrdersCount($query: String) {
    ordersCount(query: $query, limit: null) { count }
  }
`;

export const ORDER_BY_NAME = /* GraphQL */ `
  query OrderByName($query: String!) {
    orders(first: 1, query: $query) { nodes { id name } }
  }
`;
