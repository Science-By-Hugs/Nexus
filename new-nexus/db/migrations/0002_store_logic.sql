-- New NEXUS: store logic that must be atomic.
-- Each function runs as one statement, so the Worker needs a single round
-- trip to Neon per action and never leaves half-written orders behind.
-- Errors are raised with stable codes in the message (e.g. 'insufficient_stock')
-- so the API can map them to user-facing responses.

-- ---------------------------------------------------------------------------
-- Guard: only approved researchers can place orders, whatever path inserts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION orders_require_approved_customer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customers
    WHERE id = NEW.customer_id AND verification_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'researcher_not_approved';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_approved_customer BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_require_approved_customer();

-- ---------------------------------------------------------------------------
-- Tax
-- ---------------------------------------------------------------------------
-- Nevada ZIPs must have a loaded rate (a missing one blocks checkout rather
-- than silently charging 0%). Out-of-state orders collect no tax by default.
CREATE OR REPLACE FUNCTION order_tax_rate(p_zip text, p_state text, p_on date DEFAULT current_date)
RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate numeric;
BEGIN
  IF upper(p_state) <> 'NV' THEN
    RETURN 0;
  END IF;
  SELECT combined_rate INTO v_rate
  FROM tax_rates
  WHERE zip = p_zip AND state = 'NV' AND effective_from <= p_on
  ORDER BY effective_from DESC
  LIMIT 1;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'tax_rate_missing:%', p_zip;
  END IF;
  RETURN v_rate;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reservations
-- ---------------------------------------------------------------------------
-- Releases stock held by unpaid orders whose hold has lapsed. Called lazily by
-- checkout and catalog reads instead of a cron, so Neon is never woken just
-- to sweep (keeps compute hours down).
CREATE OR REPLACE FUNCTION expire_stale_orders() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    SELECT id FROM orders
    WHERE status = 'pending_payment' AND reservation_expires_at < now()
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  ),
  released AS (
    SELECT oi.variant_id, sum(oi.qty)::integer AS qty
    FROM order_items oi JOIN stale s ON s.id = oi.order_id
    GROUP BY oi.variant_id
  ),
  inv AS (
    UPDATE inventory i SET reserved = i.reserved - r.qty
    FROM released r WHERE i.variant_id = r.variant_id
    RETURNING 1
  )
  UPDATE orders o SET status = 'expired'
  FROM stale s WHERE o.id = s.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Creates a pending order, reserves its stock, prices it (items, per-vendor
-- shipping, ZIP tax on the subtotal only) and opens one shipment per vendor.
-- p_items: [{"variant_id": "...", "qty": 2}, ...]
-- p_ship_to: address snapshot, must include "zip" and "state".
CREATE OR REPLACE FUNCTION create_order(
  p_customer_id   uuid,
  p_fulfillment   text,
  p_ship_to       jsonb,
  p_items         jsonb,
  p_ruo_accepted  boolean,
  p_hold          interval DEFAULT interval '30 minutes'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id   uuid;
  v_zip        text := p_ship_to->>'zip';
  v_state      text := upper(p_ship_to->>'state');
  v_subtotal   integer;
  v_shipping   integer;
  v_rate       numeric;
  v_tax        integer;
  v_lines      integer;
  v_short      text;
  v_no_rate    text;
BEGIN
  IF NOT coalesce(p_ruo_accepted, false) THEN
    RAISE EXCEPTION 'ruo_terms_not_accepted';
  END IF;
  IF p_fulfillment NOT IN ('drop_off', 'ship') THEN
    RAISE EXCEPTION 'invalid_fulfillment';
  END IF;
  IF v_zip IS NULL OR v_zip !~ '^[0-9]{5}$' OR v_state IS NULL THEN
    RAISE EXCEPTION 'invalid_address';
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'empty_cart';
  END IF;

  PERFORM expire_stale_orders();

  -- Normalise the cart (merge duplicate variants) and join live catalog data.
  CREATE TEMP TABLE _cart ON COMMIT DROP AS
  SELECT v.id AS variant_id, v.vendor_id, p.name AS product_name, v.label AS variant_label,
         v.price_cents, c.qty
  FROM (
    SELECT (e->>'variant_id')::uuid AS variant_id, sum((e->>'qty')::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) e
    GROUP BY 1
  ) c
  JOIN variants v ON v.id = c.variant_id AND v.active
  JOIN products p ON p.id = v.product_id AND p.status = 'active';

  SELECT count(*) INTO v_lines FROM _cart;
  IF v_lines <> (SELECT count(DISTINCT e->>'variant_id') FROM jsonb_array_elements(p_items) e) THEN
    RAISE EXCEPTION 'item_unavailable';
  END IF;
  IF EXISTS (SELECT 1 FROM _cart WHERE qty IS NULL OR qty <= 0 OR qty > 100) THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  -- Lock stock rows in a fixed order (no deadlocks), then check availability.
  PERFORM 1 FROM inventory i JOIN _cart c ON c.variant_id = i.variant_id
  ORDER BY i.variant_id FOR UPDATE OF i;

  SELECT string_agg(c.variant_id::text, ',') INTO v_short
  FROM _cart c LEFT JOIN inventory i ON i.variant_id = c.variant_id
  WHERE coalesce(i.on_hand - i.reserved, 0) < c.qty;
  IF v_short IS NOT NULL THEN
    RAISE EXCEPTION 'insufficient_stock:%', v_short;
  END IF;

  -- Every vendor in the cart needs a live rate for this fulfillment method.
  SELECT string_agg(DISTINCT c.vendor_id::text, ',') INTO v_no_rate
  FROM _cart c
  LEFT JOIN shipping_rates r ON r.vendor_id = c.vendor_id AND r.method = p_fulfillment AND r.active
  WHERE r.id IS NULL;
  IF v_no_rate IS NOT NULL THEN
    RAISE EXCEPTION 'shipping_rate_missing:%', v_no_rate;
  END IF;

  SELECT sum(price_cents * qty)::integer INTO v_subtotal FROM _cart;
  SELECT sum(r.rate_cents)::integer INTO v_shipping
  FROM (SELECT DISTINCT vendor_id FROM _cart) cv
  JOIN shipping_rates r ON r.vendor_id = cv.vendor_id AND r.method = p_fulfillment AND r.active;

  v_rate := order_tax_rate(v_zip, v_state);
  -- Shipping is listed separately, so it is not taxed in Nevada.
  v_tax := round(v_subtotal * v_rate)::integer;

  INSERT INTO orders (customer_id, fulfillment, ship_to, ship_zip, ruo_accepted_at,
                      subtotal_cents, shipping_cents, tax_rate, tax_cents, total_cents,
                      reservation_expires_at)
  VALUES (p_customer_id, p_fulfillment, p_ship_to, v_zip, now(),
          v_subtotal, v_shipping, v_rate, v_tax, v_subtotal + v_shipping + v_tax,
          now() + p_hold)
  RETURNING id INTO v_order_id;

  INSERT INTO order_items (order_id, variant_id, vendor_id, product_name, variant_label, qty, unit_price_cents)
  SELECT v_order_id, variant_id, vendor_id, product_name, variant_label, qty, price_cents FROM _cart;

  INSERT INTO shipments (order_id, vendor_id, method, rate_cents)
  SELECT v_order_id, cv.vendor_id, p_fulfillment, r.rate_cents
  FROM (SELECT DISTINCT vendor_id FROM _cart) cv
  JOIN shipping_rates r ON r.vendor_id = cv.vendor_id AND r.method = p_fulfillment AND r.active;

  UPDATE inventory i SET reserved = i.reserved + c.qty
  FROM _cart c WHERE i.variant_id = c.variant_id;

  DROP TABLE _cart;
  RETURN v_order_id;
END;
$$;

-- Cancels an unpaid order and releases its hold. No-op for any other status.
CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM orders WHERE id = p_order_id AND status = 'pending_payment' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE inventory i SET reserved = i.reserved - oi.qty
  FROM order_items oi WHERE oi.order_id = p_order_id AND i.variant_id = oi.variant_id;
  UPDATE orders SET status = 'cancelled' WHERE id = p_order_id;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Payment confirmation (PayPal capture response or webhook; safe to repeat)
-- Returns: 'paid' | 'duplicate' | 'needs_review'
--   needs_review = money captured after the hold expired and stock is gone;
--   the order stays 'expired' with a captured payment so the admin can refund.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_order_paid(
  p_order_id      uuid,
  p_provider      text,
  p_provider_ref  text,
  p_amount_cents  integer,
  p_fee_cents     integer DEFAULT 0,
  p_raw           jsonb DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_order  orders%ROWTYPE;
  v_short  boolean;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM payments
             WHERE provider = p_provider AND provider_ref = p_provider_ref AND status = 'captured') THEN
    RETURN 'duplicate';
  END IF;

  IF p_amount_cents <> v_order.total_cents THEN
    RAISE EXCEPTION 'amount_mismatch:expected %, got %', v_order.total_cents, p_amount_cents;
  END IF;

  INSERT INTO payments (order_id, provider, provider_ref, amount_cents, fee_cents, status, raw)
  VALUES (p_order_id, p_provider, p_provider_ref, p_amount_cents, coalesce(p_fee_cents, 0), 'captured', p_raw)
  ON CONFLICT (provider, provider_ref)
  DO UPDATE SET status = 'captured', amount_cents = EXCLUDED.amount_cents,
                fee_cents = EXCLUDED.fee_cents, raw = EXCLUDED.raw;

  IF v_order.status = 'pending_payment' THEN
    -- Held stock becomes sold stock.
    UPDATE inventory i SET on_hand = i.on_hand - oi.qty, reserved = i.reserved - oi.qty
    FROM order_items oi WHERE oi.order_id = p_order_id AND i.variant_id = oi.variant_id;

  ELSIF v_order.status IN ('expired', 'cancelled') THEN
    -- Paid after the hold lapsed: take stock again only if it is still there.
    PERFORM 1 FROM inventory i JOIN order_items oi ON oi.variant_id = i.variant_id
    WHERE oi.order_id = p_order_id ORDER BY i.variant_id FOR UPDATE OF i;

    SELECT bool_or(i.on_hand - i.reserved < oi.qty) INTO v_short
    FROM order_items oi JOIN inventory i ON i.variant_id = oi.variant_id
    WHERE oi.order_id = p_order_id;
    IF v_short THEN
      RETURN 'needs_review';
    END IF;
    UPDATE inventory i SET on_hand = i.on_hand - oi.qty
    FROM order_items oi WHERE oi.order_id = p_order_id AND i.variant_id = oi.variant_id;

  ELSE
    -- Already paid through another capture id: record it, flag for review.
    RETURN 'needs_review';
  END IF;

  INSERT INTO stock_movements (variant_id, delta, reason, order_id)
  SELECT variant_id, -qty, 'sale', p_order_id FROM order_items WHERE order_id = p_order_id;

  UPDATE orders SET status = 'paid', paid_at = now() WHERE id = p_order_id;
  RETURN 'paid';
END;
$$;

-- ---------------------------------------------------------------------------
-- Stock changes from the admin dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION adjust_stock(
  p_variant_id  uuid,
  p_delta       integer,
  p_reason      text,
  p_note        text,
  p_admin_id    uuid
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_on_hand integer;
BEGIN
  IF p_reason NOT IN ('restock', 'adjustment', 'return') THEN
    RAISE EXCEPTION 'invalid_reason';
  END IF;
  INSERT INTO inventory (variant_id) VALUES (p_variant_id) ON CONFLICT DO NOTHING;
  UPDATE inventory SET on_hand = on_hand + p_delta
  WHERE variant_id = p_variant_id AND on_hand + p_delta >= reserved
  RETURNING on_hand INTO v_on_hand;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_below_reserved';
  END IF;
  INSERT INTO stock_movements (variant_id, delta, reason, note, created_by)
  VALUES (p_variant_id, p_delta, p_reason, p_note, p_admin_id);
  RETURN v_on_hand;
END;
$$;

-- ---------------------------------------------------------------------------
-- Researcher approval
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_researcher_application(
  p_customer_id   uuid,
  p_institution   text,
  p_role_title    text,
  p_document_key  text
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_id     uuid;
BEGIN
  SELECT verification_status INTO v_status FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'customer_not_found';
  ELSIF v_status = 'approved' THEN
    RAISE EXCEPTION 'already_approved';
  ELSIF v_status = 'pending' THEN
    RAISE EXCEPTION 'application_pending';
  END IF;
  INSERT INTO researcher_applications (customer_id, institution, role_title, document_key)
  VALUES (p_customer_id, p_institution, p_role_title, p_document_key)
  RETURNING id INTO v_id;
  UPDATE customers SET verification_status = 'pending' WHERE id = p_customer_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION decide_researcher_application(
  p_application_id  uuid,
  p_admin_id        uuid,
  p_approve         boolean,
  p_notes           text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_customer uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  UPDATE researcher_applications
  SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewed_at = now(), reviewed_by = p_admin_id, notes = p_notes
  WHERE id = p_application_id AND status = 'pending'
  RETURNING customer_id INTO v_customer;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'application_not_pending';
  END IF;
  UPDATE customers
  SET verification_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      approved_at = CASE WHEN p_approve THEN now() ELSE NULL END
  WHERE id = v_customer;
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END;
$$;

-- ---------------------------------------------------------------------------
-- Admin views
-- ---------------------------------------------------------------------------
CREATE VIEW inventory_status AS
SELECT v.id AS variant_id, v.sku, p.name AS product_name, v.label AS variant_label,
       ve.name AS vendor_name,
       coalesce(i.on_hand, 0) AS on_hand,
       coalesce(i.reserved, 0) AS reserved,
       coalesce(i.on_hand - i.reserved, 0) AS available,
       coalesce(i.reorder_point, 0) AS reorder_point,
       coalesce(i.on_hand - i.reserved, 0) <= coalesce(i.reorder_point, 0) AS low_stock
FROM variants v
JOIN products p ON p.id = v.product_id
JOIN vendors ve ON ve.id = v.vendor_id
LEFT JOIN inventory i ON i.variant_id = v.id;

-- Daily money by provider, in Las Vegas local time.
CREATE VIEW finance_daily AS
SELECT (pa.created_at AT TIME ZONE 'America/Los_Angeles')::date AS day,
       pa.provider,
       count(*) AS payments,
       sum(pa.amount_cents) AS gross_cents,
       sum(pa.fee_cents) AS fee_cents,
       sum(pa.refunded_cents) AS refunded_cents,
       sum(pa.amount_cents - pa.fee_cents - pa.refunded_cents) AS net_cents,
       sum(o.tax_cents) AS tax_collected_cents,
       sum(o.shipping_cents) AS shipping_collected_cents
FROM payments pa
JOIN orders o ON o.id = pa.order_id
WHERE pa.status IN ('captured', 'refunded', 'partially_refunded')
GROUP BY 1, 2;
