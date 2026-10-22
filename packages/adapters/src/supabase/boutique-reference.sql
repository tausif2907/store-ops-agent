-- =============================================================================
-- Boutique reference schema + agent API (Supabase / Postgres)
--
-- The Supabase adapter never reads tables directly. It connects as the
-- restricted `agent_role`, which can only EXECUTE the functions in the
-- `agent_api` schema. Each function returns JSON already in the platform's
-- normalised shape (see packages/shared/src/types.ts).
--
-- To connect a real Supabase store: keep the agent_api function signatures and
-- return shapes, and rewrite their bodies against your own tables. The tables
-- below are a reference tailoring-boutique schema used for tests and local dev.
--
-- Optional: agent_api.capabilities() returns a JSON array of what the store
-- supports, e.g. '["orders", "inventory", "inventory.write", "coupons"]', and
-- the agent is offered only the matching tools. Without it, the adapter assumes
-- all eight (orders, inventory, coupons, reviews and their .write forms).
--
-- This script is idempotent: it drops and recreates everything except the role.
-- =============================================================================

DROP SCHEMA IF EXISTS agent_api CASCADE;
DROP TABLE IF EXISTS reviews, coupons, order_items, orders, product_variants, products, customers CASCADE;

-- ---- Reference store tables ------------------------------------------------

CREATE TABLE customers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  email      text,
  phone      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products ON DELETE CASCADE,
  title       text NOT NULL,
  sku         text UNIQUE,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  stock       integer CHECK (stock IS NULL OR stock >= 0), -- NULL = made to order, not tracked
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number  text NOT NULL UNIQUE,
  customer_id   uuid NOT NULL REFERENCES customers,
  status        text NOT NULL CHECK (status IN
                  ('placed', 'confirmed', 'stitching', 'alteration', 'ready', 'dispatched', 'delivered', 'cancelled', 'refunded')),
  total_paise   integer NOT NULL CHECK (total_paise >= 0),
  note          text,
  promised_date date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_created_idx ON orders (created_at DESC, id DESC);

CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products,
  variant_id       uuid REFERENCES product_variants,
  title            text NOT NULL,
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_paise integer NOT NULL CHECK (unit_price_paise >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE coupons (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,
  discount_type  text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  usage_count    integer NOT NULL DEFAULT 0,
  usage_limit    integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  starts_at      timestamptz,
  ends_at        timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coupons_code_key ON coupons (upper(code));

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products,
  order_id    uuid REFERENCES orders,
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       text,
  body        text NOT NULL,
  author_name text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  reply_body  text,
  replied_at  timestamptz
);
CREATE INDEX reviews_created_idx ON reviews (created_at DESC, id DESC);

-- ---- Agent API --------------------------------------------------------------

CREATE SCHEMA agent_api;

-- Helpers (not callable by agent_role) --------------------------------------

CREATE FUNCTION agent_api.iso(ts timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Keyset cursor "<utc timestamp with microseconds>_<uuid>".
CREATE FUNCTION agent_api.cursor_of(ts timestamptz, id uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '_' || id::text
$$;

CREATE FUNCTION agent_api.to_uuid(t text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN t::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END
$$;

CREATE FUNCTION agent_api.clamp_limit(p jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(GREATEST(COALESCE((p->>'limit')::integer, 25), 1), 100)
$$;

CREATE FUNCTION agent_api.normalize_status(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'placed'     THEN 'pending'
    WHEN 'confirmed'  THEN 'processing'
    WHEN 'stitching'  THEN 'processing'
    WHEN 'alteration' THEN 'processing'
    WHEN 'ready'      THEN 'ready'
    WHEN 'dispatched' THEN 'shipped'
    WHEN 'delivered'  THEN 'delivered'
    WHEN 'cancelled'  THEN 'cancelled'
    WHEN 'refunded'   THEN 'refunded'
  END
$$;

CREATE FUNCTION agent_api.platform_status(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'pending'    THEN 'placed'
    WHEN 'processing' THEN 'confirmed'
    WHEN 'ready'      THEN 'ready'
    WHEN 'shipped'    THEN 'dispatched'
    WHEN 'delivered'  THEN 'delivered'
    WHEN 'cancelled'  THEN 'cancelled'
    WHEN 'refunded'   THEN 'refunded'
  END
$$;

-- The boutique promises a delivery date; it is due by the end of that day in India.
CREATE FUNCTION agent_api.promised_at(d date) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((d + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
$$;

CREATE FUNCTION agent_api.money(amount bigint) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('amount', amount, 'currency', 'INR')
$$;

CREATE FUNCTION agent_api.order_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', o.id::text,
    'number', o.order_number,
    'status', agent_api.normalize_status(o.status),
    'platformStatus', o.status,
    'customer', jsonb_build_object('id', c.id::text, 'name', c.name, 'email', c.email, 'phone', c.phone),
    'lineItems', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'productId', i.product_id::text,
               'variantId', i.variant_id::text,
               'title', i.title,
               'quantity', i.quantity,
               'unitPrice', agent_api.money(i.unit_price_paise)) ORDER BY i.title, i.id)
      FROM order_items i WHERE i.order_id = o.id), '[]'::jsonb),
    'total', agent_api.money(o.total_paise),
    'note', o.note,
    'createdAt', agent_api.iso(o.created_at),
    'updatedAt', agent_api.iso(o.updated_at),
    'promisedAt', CASE WHEN o.promised_date IS NULL THEN NULL
                       ELSE agent_api.iso(agent_api.promised_at(o.promised_date)) END)
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.id = p_id
$$;

CREATE FUNCTION agent_api.product_json(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', p.id::text,
    'title', p.title,
    'status', p.status,
    'variants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id::text,
               'title', v.title,
               'sku', v.sku,
               'price', agent_api.money(v.price_paise),
               'stock', v.stock) ORDER BY v.position, v.id)
      FROM product_variants v WHERE v.product_id = p.id), '[]'::jsonb),
    'updatedAt', agent_api.iso(p.updated_at))
  FROM products p
  WHERE p.id = p_id
$$;

CREATE FUNCTION agent_api.coupon_json(c coupons) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', c.id::text,
    'code', c.code,
    'type', c.discount_type,
    'value', c.discount_value,
    'currency', CASE WHEN c.discount_type = 'fixed' THEN 'INR' END,
    'usageCount', c.usage_count,
    'usageLimit', c.usage_limit,
    'startsAt', agent_api.iso(c.starts_at),
    'endsAt', agent_api.iso(c.ends_at),
    'active', c.is_active
              AND (c.ends_at IS NULL OR c.ends_at > now())
              AND (c.usage_limit IS NULL OR c.usage_count < c.usage_limit))
$$;

CREATE FUNCTION agent_api.review_json(r reviews) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', r.id::text,
    'productId', r.product_id::text,
    'orderId', r.order_id::text,
    'rating', r.rating,
    'title', r.title,
    'body', r.body,
    'author', r.author_name,
    'createdAt', agent_api.iso(r.created_at),
    'reply', CASE WHEN r.reply_body IS NULL THEN NULL
                  ELSE jsonb_build_object('body', r.reply_body, 'createdAt', agent_api.iso(r.replied_at)) END)
$$;

-- Public API (callable by agent_role) ---------------------------------------
-- Errors: P0002 = not found, 22023 = invalid input, 23505 = conflict.

CREATE FUNCTION agent_api.list_orders(p jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit     integer := agent_api.clamp_limit(p);
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows      record;
  v_ids       uuid[] := '{}';
  v_last_ts   timestamptz;
  v_last_id   uuid;
  v_more      boolean := false;
BEGIN
  IF p->>'cursor' IS NOT NULL THEN
    BEGIN
      v_cursor_ts := split_part(p->>'cursor', '_', 1)::timestamptz;
      v_cursor_id := split_part(p->>'cursor', '_', 2)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid cursor' USING ERRCODE = '22023';
    END;
  END IF;

  FOR v_rows IN
    SELECT o.id, o.created_at
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE (p->>'status' IS NULL OR agent_api.normalize_status(o.status) = p->>'status')
      AND (p->>'createdFrom' IS NULL OR o.created_at >= (p->>'createdFrom')::timestamptz)
      AND (p->>'createdTo' IS NULL OR o.created_at < (p->>'createdTo')::timestamptz)
      AND (NOT COALESCE((p->>'overdue')::boolean, false)
           OR (o.promised_date IS NOT NULL
               AND agent_api.promised_at(o.promised_date) < now()
               AND o.status NOT IN ('delivered', 'cancelled', 'refunded')))
      AND (p->>'query' IS NULL
           OR o.order_number ILIKE '%' || (p->>'query') || '%'
           OR c.name ILIKE '%' || (p->>'query') || '%'
           OR c.email ILIKE '%' || (p->>'query') || '%')
      AND (v_cursor_id IS NULL OR (o.created_at, o.id) < (v_cursor_ts, v_cursor_id))
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT v_limit + 1
  LOOP
    IF cardinality(v_ids) = v_limit THEN
      v_more := true;
      EXIT;
    END IF;
    v_ids := v_ids || v_rows.id;
    v_last_ts := v_rows.created_at;
    v_last_id := v_rows.id;
  END LOOP;

  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(agent_api.order_json(x) ORDER BY n)
                       FROM unnest(v_ids) WITH ORDINALITY AS u(x, n)), '[]'::jsonb),
    'nextCursor', CASE WHEN v_more THEN agent_api.cursor_of(v_last_ts, v_last_id) END);
END
$$;

CREATE FUNCTION agent_api.get_order(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb := agent_api.order_json(agent_api.to_uuid(p_id));
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'order % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v;
END
$$;

CREATE FUNCTION agent_api.update_order_status(p_id text, p_status text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      uuid := agent_api.to_uuid(p_id);
  v_current text;
  v_target  text := agent_api.platform_status(p_status);
BEGIN
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'unknown status %', p_status USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_current FROM orders WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF agent_api.normalize_status(v_current) <> p_status THEN
    IF v_current IN ('cancelled', 'refunded') THEN
      RAISE EXCEPTION 'order % is % and cannot change status', p_id, v_current USING ERRCODE = '22023';
    END IF;
    UPDATE orders SET status = v_target, updated_at = now() WHERE id = v_id;
  END IF;
  RETURN agent_api.order_json(v_id);
END
$$;

CREATE FUNCTION agent_api.list_products(p jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit  integer := agent_api.clamp_limit(p);
  v_cursor uuid;
  v_ids    uuid[];
  v_more   boolean;
BEGIN
  IF p->>'cursor' IS NOT NULL THEN
    v_cursor := agent_api.to_uuid(p->>'cursor');
    IF v_cursor IS NULL THEN
      RAISE EXCEPTION 'invalid cursor' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
    SELECT pr.id FROM products pr
    WHERE (p->>'query' IS NULL
           OR pr.title ILIKE '%' || (p->>'query') || '%'
           OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = pr.id AND v.sku ILIKE '%' || (p->>'query') || '%'))
      AND (p->>'lowStockThreshold' IS NULL
           OR EXISTS (SELECT 1 FROM product_variants v
                      WHERE v.product_id = pr.id AND v.stock IS NOT NULL AND v.stock <= (p->>'lowStockThreshold')::integer))
      AND (v_cursor IS NULL OR pr.id > v_cursor)
    ORDER BY pr.id
    LIMIT v_limit + 1) s;

  v_ids := COALESCE(v_ids, '{}');
  v_more := cardinality(v_ids) > v_limit;
  IF v_more THEN
    v_ids := v_ids[1:v_limit];
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(agent_api.product_json(x) ORDER BY n)
                       FROM unnest(v_ids) WITH ORDINALITY AS u(x, n)), '[]'::jsonb),
    'nextCursor', CASE WHEN v_more THEN v_ids[v_limit]::text END);
END
$$;

CREATE FUNCTION agent_api.get_variant_product(p_variant_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product uuid;
BEGIN
  SELECT product_id INTO v_product FROM product_variants WHERE id = agent_api.to_uuid(p_variant_id);
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = 'P0002';
  END IF;
  RETURN agent_api.product_json(v_product);
END
$$;

CREATE FUNCTION agent_api.update_stock(p_variant_id text, p_qty integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product uuid;
BEGIN
  IF p_qty IS NULL OR p_qty < 0 THEN
    RAISE EXCEPTION 'stock must be zero or more' USING ERRCODE = '22023';
  END IF;
  UPDATE product_variants SET stock = p_qty
  WHERE id = agent_api.to_uuid(p_variant_id)
  RETURNING product_id INTO v_product;
  IF v_product IS NULL THEN
    RAISE EXCEPTION 'variant % not found', p_variant_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE products SET updated_at = now() WHERE id = v_product;
  RETURN agent_api.product_json(v_product);
END
$$;

CREATE FUNCTION agent_api.list_coupons() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(agent_api.coupon_json(c) ORDER BY c.created_at DESC, c.id), '[]'::jsonb)
  FROM coupons c
$$;

CREATE FUNCTION agent_api.create_coupon(p jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v coupons;
BEGIN
  IF p->>'type' NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'type must be percent or fixed' USING ERRCODE = '22023';
  END IF;
  IF (p->>'value')::integer <= 0 OR (p->>'type' = 'percent' AND (p->>'value')::integer > 100) THEN
    RAISE EXCEPTION 'invalid coupon value' USING ERRCODE = '22023';
  END IF;
  INSERT INTO coupons (code, discount_type, discount_value, usage_limit, starts_at, ends_at)
  VALUES (upper(p->>'code'), p->>'type', (p->>'value')::integer, (p->>'usageLimit')::integer,
          (p->>'startsAt')::timestamptz, (p->>'endsAt')::timestamptz)
  RETURNING * INTO v;
  RETURN agent_api.coupon_json(v);
END
$$;

CREATE FUNCTION agent_api.list_reviews(p jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit     integer := agent_api.clamp_limit(p);
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
  v_rows      record;
  v_ids       uuid[] := '{}';
  v_last_ts   timestamptz;
  v_last_id   uuid;
  v_more      boolean := false;
BEGIN
  IF p->>'cursor' IS NOT NULL THEN
    BEGIN
      v_cursor_ts := split_part(p->>'cursor', '_', 1)::timestamptz;
      v_cursor_id := split_part(p->>'cursor', '_', 2)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid cursor' USING ERRCODE = '22023';
    END;
  END IF;

  FOR v_rows IN
    SELECT r.id, r.created_at FROM reviews r
    WHERE (p->>'minRating' IS NULL OR r.rating >= (p->>'minRating')::integer)
      AND (p->>'maxRating' IS NULL OR r.rating <= (p->>'maxRating')::integer)
      AND (NOT COALESCE((p->>'unreplied')::boolean, false) OR r.reply_body IS NULL)
      AND (p->>'since' IS NULL OR r.created_at >= (p->>'since')::timestamptz)
      AND (p->>'productId' IS NULL OR r.product_id = agent_api.to_uuid(p->>'productId'))
      AND (v_cursor_id IS NULL OR (r.created_at, r.id) < (v_cursor_ts, v_cursor_id))
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT v_limit + 1
  LOOP
    IF cardinality(v_ids) = v_limit THEN
      v_more := true;
      EXIT;
    END IF;
    v_ids := v_ids || v_rows.id;
    v_last_ts := v_rows.created_at;
    v_last_id := v_rows.id;
  END LOOP;

  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(agent_api.review_json(r) ORDER BY u.n)
                       FROM unnest(v_ids) WITH ORDINALITY AS u(x, n)
                       JOIN reviews r ON r.id = u.x), '[]'::jsonb),
    'nextCursor', CASE WHEN v_more THEN agent_api.cursor_of(v_last_ts, v_last_id) END);
END
$$;

CREATE FUNCTION agent_api.reply_to_review(p_id text, p_body text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v reviews;
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'reply cannot be empty' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM reviews WHERE id = agent_api.to_uuid(p_id) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v.reply_body IS NOT NULL THEN
    RAISE EXCEPTION 'review % already has a reply', p_id USING ERRCODE = '23505';
  END IF;
  UPDATE reviews SET reply_body = btrim(p_body), replied_at = now() WHERE id = v.id RETURNING * INTO v;
  RETURN agent_api.review_json(v);
END
$$;

CREATE FUNCTION agent_api.sales_summary(p_from text, p_to text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from  timestamptz;
  v_to    timestamptz;
  v_count integer;
  v_gross bigint;
BEGIN
  BEGIN
    v_from := p_from::timestamptz;
    v_to := p_to::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'from and to must be ISO timestamps' USING ERRCODE = '22023';
  END;
  IF v_to <= v_from THEN
    RAISE EXCEPTION 'to must be after from' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), COALESCE(sum(total_paise), 0) INTO v_count, v_gross
  FROM orders
  WHERE created_at >= v_from AND created_at < v_to AND status NOT IN ('cancelled', 'refunded');

  RETURN jsonb_build_object(
    'from', agent_api.iso(v_from),
    'to', agent_api.iso(v_to),
    'currency', 'INR',
    'orderCount', v_count,
    'grossSales', agent_api.money(v_gross),
    'averageOrderValue', agent_api.money(CASE WHEN v_count = 0 THEN 0 ELSE round(v_gross::numeric / v_count)::bigint END),
    'topProducts', COALESCE((
      SELECT jsonb_agg(t.j ORDER BY t.revenue DESC, t.product_id)
      FROM (
        SELECT i.product_id,
               sum(i.quantity * i.unit_price_paise) AS revenue,
               jsonb_build_object(
                 'productId', i.product_id::text,
                 'title', pr.title,
                 'quantity', sum(i.quantity),
                 'revenue', agent_api.money(sum(i.quantity * i.unit_price_paise))) AS j
        FROM order_items i
        JOIN orders o ON o.id = i.order_id
        JOIN products pr ON pr.id = i.product_id
        WHERE o.created_at >= v_from AND o.created_at < v_to AND o.status NOT IN ('cancelled', 'refunded')
        GROUP BY i.product_id, pr.title
        ORDER BY revenue DESC, i.product_id
        LIMIT 5) t), '[]'::jsonb));
END
$$;

-- ---- The restricted role the adapter connects as ----------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_role') THEN
    -- Local development password; on Supabase create the role with a strong one.
    CREATE ROLE agent_role LOGIN PASSWORD 'agent_role' NOINHERIT;
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM agent_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA agent_api FROM PUBLIC;
GRANT USAGE ON SCHEMA agent_api TO agent_role;
GRANT EXECUTE ON FUNCTION
  agent_api.list_orders(jsonb),
  agent_api.get_order(text),
  agent_api.update_order_status(text, text),
  agent_api.list_products(jsonb),
  agent_api.get_variant_product(text),
  agent_api.update_stock(text, integer),
  agent_api.list_coupons(),
  agent_api.create_coupon(jsonb),
  agent_api.list_reviews(jsonb),
  agent_api.reply_to_review(text, text),
  agent_api.sales_summary(text, text)
TO agent_role;
