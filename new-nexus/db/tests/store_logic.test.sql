-- Behaviour tests for 0002_store_logic.sql. Runs against a throwaway database
-- (see run-tests.sh). All data here is synthetic test data.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
\o /dev/null

-- Asserts that a statement fails with a message starting with p_code.
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'expected error % but statement succeeded: %', p_code, p_sql;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE p_code || '%' THEN
    RAISE EXCEPTION 'expected error %, got: %', p_code, SQLERRM;
  END IF;
END;
$$;

-- Fixtures ------------------------------------------------------------------
INSERT INTO customers (id, auth_user_id, email, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'auth-admin', 'admin@test.invalid', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'auth-c1', 'c1@test.invalid', 'customer'),
  ('00000000-0000-0000-0000-0000000000c2', 'auth-c2', 'c2@test.invalid', 'customer');

INSERT INTO vendors (id, name) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Vendor One'),
  ('00000000-0000-0000-0000-0000000000f2', 'Vendor Two');
INSERT INTO shipping_rates (vendor_id, method, rate_cents) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'drop_off', 500),
  ('00000000-0000-0000-0000-0000000000f1', 'ship', 1200),
  ('00000000-0000-0000-0000-0000000000f2', 'ship', 900);

INSERT INTO products (id, name, slug, status) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'Test Vials', 'test-vials', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', 'Test Swabs', 'test-swabs', 'active'),
  ('00000000-0000-0000-0000-0000000000b3', 'Draft Item', 'draft-item', 'draft');
INSERT INTO variants (id, product_id, vendor_id, sku, label, price_cents) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 'VIAL-10', '10 pack', 2000),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f2', 'SWAB-50', '50 pack', 1000),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', 'DRAFT-1', 'each', 500);
INSERT INTO inventory (variant_id, on_hand, reorder_point) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 5, 2),
  ('00000000-0000-0000-0000-0000000000d2', 10, 0),
  ('00000000-0000-0000-0000-0000000000d3', 10, 0);

INSERT INTO tax_rates (zip, state, county, combined_rate, effective_from) VALUES
  ('89101', 'NV', 'Clark', 0.08375, '2026-01-01'),
  ('89101', 'NV', 'Clark', 0.08000, '2020-01-01');

-- Tax -------------------------------------------------------------------------
DO $$ BEGIN
  ASSERT order_tax_rate('89101', 'NV') = 0.08375, 'latest NV rate used';
  ASSERT order_tax_rate('89101', 'NV', '2021-06-01') = 0.08, 'rate as of a past date';
  ASSERT order_tax_rate('10001', 'NY') = 0, 'out of state collects no tax';
END $$;
SELECT pg_temp.expect_error($$SELECT order_tax_rate('89999', 'NV')$$, 'tax_rate_missing');

-- Researcher approval ---------------------------------------------------------
-- Unapproved customers cannot order, by function or direct insert.
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":1}]', true)$$,
  'researcher_not_approved');

DO $$
DECLARE v_app uuid;
BEGIN
  v_app := submit_researcher_application('00000000-0000-0000-0000-0000000000c1', 'Test Lab', 'Researcher', NULL);
  ASSERT (SELECT verification_status FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c1') = 'pending';
  ASSERT decide_researcher_application(v_app, '00000000-0000-0000-0000-0000000000a1', true, 'ok') = 'approved';
  ASSERT (SELECT verification_status FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c1') = 'approved';
  ASSERT (SELECT approved_at IS NOT NULL FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c1');
END $$;
SELECT pg_temp.expect_error($$SELECT submit_researcher_application('00000000-0000-0000-0000-0000000000c1', 'X', 'Y', NULL)$$, 'already_approved');

-- A non-admin cannot decide; a rejected customer can re-apply.
DO $$
DECLARE v_app uuid;
BEGIN
  v_app := submit_researcher_application('00000000-0000-0000-0000-0000000000c2', 'Lab Two', 'Tech', 'docs/c2.pdf');
  PERFORM pg_temp.expect_error(format('SELECT decide_researcher_application(%L, %L, true)', v_app, '00000000-0000-0000-0000-0000000000c1'), 'not_admin');
  PERFORM pg_temp.expect_error($q$SELECT submit_researcher_application('00000000-0000-0000-0000-0000000000c2', 'X', 'Y', NULL)$q$, 'application_pending');
  ASSERT decide_researcher_application(v_app, '00000000-0000-0000-0000-0000000000a1', false, 'need more') = 'rejected';
  ASSERT (SELECT verification_status FROM customers WHERE id = '00000000-0000-0000-0000-0000000000c2') = 'rejected';
  PERFORM submit_researcher_application('00000000-0000-0000-0000-0000000000c2', 'Lab Two', 'Tech', 'docs/c2-v2.pdf');
  ASSERT (SELECT count(*) FROM researcher_applications WHERE customer_id = '00000000-0000-0000-0000-0000000000c2') = 2;
END $$;

-- Checkout guards -------------------------------------------------------------
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":1}]', false)$$,
  'ruo_terms_not_accepted');
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89101","state":"NV"}', '[]', true)$$, 'empty_cart');
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d3","qty":1}]', true)$$,
  'item_unavailable');
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":6}]', true)$$,
  'insufficient_stock');
-- Vendor Two has no drop-off rate.
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'drop_off',
  '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d2","qty":1}]', true)$$,
  'shipping_rate_missing');
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89999","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":1}]', true)$$,
  'tax_rate_missing');

-- Pricing: two vendors, NV tax on subtotal only --------------------------------
CREATE TEMP TABLE t (k text PRIMARY KEY, id uuid);
DO $$
DECLARE v_id uuid; o orders%ROWTYPE;
BEGIN
  v_id := create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
    '{"zip":"89101","state":"NV","line1":"1 Test St"}',
    '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":2},
      {"variant_id":"00000000-0000-0000-0000-0000000000d2","qty":1},
      {"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":1}]', true);
  INSERT INTO t VALUES ('two_vendor', v_id);
  SELECT * INTO o FROM orders WHERE id = v_id;
  ASSERT o.subtotal_cents = 3 * 2000 + 1000, 'duplicate lines merged: ' || o.subtotal_cents;
  ASSERT o.shipping_cents = 1200 + 900, 'one rate per vendor: ' || o.shipping_cents;
  ASSERT o.tax_cents = 586, 'tax = round(7000 * 0.08375) = 586, got ' || o.tax_cents;
  ASSERT o.total_cents = 7000 + 2100 + 586;
  ASSERT o.status = 'pending_payment';
  ASSERT (SELECT count(*) FROM shipments WHERE order_id = v_id) = 2;
  ASSERT (SELECT reserved FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 3;
  ASSERT (SELECT available FROM inventory_status WHERE sku = 'VIAL-10') = 2;
  ASSERT (SELECT low_stock FROM inventory_status WHERE sku = 'VIAL-10');
END $$;

-- Reserved stock cannot be sold twice.
SELECT pg_temp.expect_error($$SELECT create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
  '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":3}]', true)$$,
  'insufficient_stock');
-- Admin cannot cut stock below what is reserved.
SELECT pg_temp.expect_error($$SELECT adjust_stock('00000000-0000-0000-0000-0000000000d1', -3, 'adjustment', 'count', '00000000-0000-0000-0000-0000000000a1')$$,
  'stock_below_reserved');

-- Payment ---------------------------------------------------------------------
DO $$
DECLARE v_id uuid := (SELECT id FROM t WHERE k = 'two_vendor'); v_total integer;
BEGIN
  SELECT total_cents INTO v_total FROM orders WHERE id = v_id;
  PERFORM pg_temp.expect_error(format('SELECT mark_order_paid(%L, %L, %L, %s)', v_id, 'paypal', 'CAP-1', v_total - 1), 'amount_mismatch');
  ASSERT mark_order_paid(v_id, 'paypal', 'CAP-1', v_total, 300) = 'paid';
  ASSERT mark_order_paid(v_id, 'paypal', 'CAP-1', v_total, 300) = 'duplicate', 'webhook retry is a no-op';
  ASSERT (SELECT status FROM orders WHERE id = v_id) = 'paid';
  ASSERT (SELECT on_hand FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 2;
  ASSERT (SELECT reserved FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 0;
  ASSERT (SELECT count(*) FROM stock_movements WHERE order_id = v_id AND reason = 'sale') = 2;
  ASSERT (SELECT count(*) FROM payments WHERE order_id = v_id) = 1;
  ASSERT (SELECT net_cents FROM finance_daily WHERE provider = 'paypal') = v_total - 300;
END $$;

-- Expiry and cancellation -------------------------------------------------------
DO $$
DECLARE v_a uuid; v_b uuid; v_total integer;
BEGIN
  v_a := create_order('00000000-0000-0000-0000-0000000000c1', 'drop_off',
    '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":2}]', true);
  ASSERT (SELECT shipping_cents FROM orders WHERE id = v_a) = 500, 'drop-off rate used';
  ASSERT (SELECT reserved FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 2;

  -- Hold lapses: next checkout releases it lazily.
  UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = v_a;
  ASSERT expire_stale_orders() = 1;
  ASSERT (SELECT status FROM orders WHERE id = v_a) = 'expired';
  ASSERT (SELECT reserved FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 0;

  -- Late payment with stock still there: order is recovered.
  SELECT total_cents INTO v_total FROM orders WHERE id = v_a;
  ASSERT mark_order_paid(v_a, 'paypal', 'CAP-LATE', v_total) = 'paid';
  ASSERT (SELECT on_hand FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 0;

  -- Cancel releases the hold; cancelling twice is a no-op.
  v_b := create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
    '{"zip":"10001","state":"NY"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d2","qty":4}]', true);
  ASSERT (SELECT tax_cents FROM orders WHERE id = v_b) = 0, 'out of state untaxed';
  ASSERT cancel_order(v_b);
  ASSERT NOT cancel_order(v_b);
  ASSERT (SELECT reserved FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d2') = 0;
END $$;

-- Late payment when the stock has gone: flagged, not oversold.
DO $$
DECLARE v_c uuid; v_total integer;
BEGIN
  PERFORM adjust_stock('00000000-0000-0000-0000-0000000000d1', 1, 'restock', NULL, '00000000-0000-0000-0000-0000000000a1');
  v_c := create_order('00000000-0000-0000-0000-0000000000c1', 'ship',
    '{"zip":"89101","state":"NV"}', '[{"variant_id":"00000000-0000-0000-0000-0000000000d1","qty":1}]', true);
  UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = v_c;
  PERFORM expire_stale_orders();
  PERFORM adjust_stock('00000000-0000-0000-0000-0000000000d1', -1, 'adjustment', 'damaged', '00000000-0000-0000-0000-0000000000a1');
  SELECT total_cents INTO v_total FROM orders WHERE id = v_c;
  ASSERT mark_order_paid(v_c, 'paypal', 'CAP-GONE', v_total) = 'needs_review';
  ASSERT (SELECT status FROM orders WHERE id = v_c) = 'expired';
  ASSERT (SELECT status FROM payments WHERE provider_ref = 'CAP-GONE') = 'captured';
  ASSERT (SELECT on_hand FROM inventory WHERE variant_id = '00000000-0000-0000-0000-0000000000d1') = 0;
END $$;

-- Adjustments need a note.
SELECT pg_temp.expect_error($$SELECT adjust_stock('00000000-0000-0000-0000-0000000000d2', 1, 'adjustment', NULL, '00000000-0000-0000-0000-0000000000a1')$$,
  'new row for relation "stock_movements" violates check constraint');

\echo 'store_logic tests passed'
