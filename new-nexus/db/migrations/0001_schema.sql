-- New NEXUS: core schema (Neon Postgres 17)
-- Research-use-only store: verified researchers only, PayPal checkout,
-- per-vendor shipping, ZIP-based sales tax. Money is integer cents.

CREATE EXTENSION IF NOT EXISTS citext;

-- Keeps updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id         text NOT NULL UNIQUE,          -- subject from Neon Auth
  email                citext NOT NULL UNIQUE,
  name                 text,
  phone                text,
  role                 text NOT NULL DEFAULT 'customer'
                         CHECK (role IN ('customer', 'admin')),
  verification_status  text NOT NULL DEFAULT 'unsubmitted'
                         CHECK (verification_status IN ('unsubmitted', 'pending', 'approved', 'rejected')),
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((verification_status = 'approved') = (approved_at IS NOT NULL))
);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE researcher_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  institution   text NOT NULL CHECK (length(trim(institution)) > 0),
  role_title    text NOT NULL CHECK (length(trim(role_title)) > 0),
  document_key  text,                                  -- R2 object key, private bucket
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES customers(id),
  notes         text,
  CHECK ((status = 'pending') = (reviewed_at IS NULL))
);
-- At most one open application per customer.
CREATE UNIQUE INDEX researcher_applications_one_pending
  ON researcher_applications (customer_id) WHERE status = 'pending';
CREATE INDEX researcher_applications_queue
  ON researcher_applications (submitted_at) WHERE status = 'pending';

CREATE TABLE addresses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  recipient         text NOT NULL,
  line1             text NOT NULL,
  line2             text,
  city              text NOT NULL,
  state             char(2) NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  zip               text NOT NULL CHECK (zip ~ '^[0-9]{5}$'),
  phone             text,
  in_drop_off_zone  boolean NOT NULL DEFAULT false,
  is_default        boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_customer ON addresses (customer_id);
CREATE UNIQUE INDEX addresses_one_default
  ON addresses (customer_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- Vendors and catalog
-- ---------------------------------------------------------------------------

CREATE TABLE vendors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  contact_email  citext,
  contact_phone  text,
  active         boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shipping_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  method      text NOT NULL CHECK (method IN ('drop_off', 'ship')),
  rate_cents  integer NOT NULL CHECK (rate_cents >= 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- One live rate per vendor and method; old rates stay for history.
CREATE UNIQUE INDEX shipping_rates_one_active
  ON shipping_rates (vendor_id, method) WHERE active;

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description       text,
  category          text,
  ruo               boolean NOT NULL DEFAULT true,    -- research use only
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'active', 'archived')),
  legacy_source_id  text UNIQUE,                      -- set when imported from the old Nexus catalog
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE variants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vendor_id    uuid NOT NULL REFERENCES vendors(id),
  sku          text NOT NULL UNIQUE,
  label        text NOT NULL,                         -- size or pack, e.g. "10 x 3 mL"
  price_cents  integer NOT NULL CHECK (price_cents > 0),
  image_keys   text[] NOT NULL DEFAULT '{}',          -- R2 object keys
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX variants_product ON variants (product_id);
CREATE INDEX variants_vendor ON variants (vendor_id);

CREATE TABLE inventory (
  variant_id     uuid PRIMARY KEY REFERENCES variants(id) ON DELETE CASCADE,
  on_hand        integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved       integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  reorder_point  integer NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved <= on_hand)
);
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Orders, payments, delivery
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number            bigint GENERATED ALWAYS AS IDENTITY (START WITH 10001) UNIQUE,
  customer_id             uuid NOT NULL REFERENCES customers(id),
  status                  text NOT NULL DEFAULT 'pending_payment'
                            CHECK (status IN ('pending_payment', 'paid', 'packed', 'out_for_delivery',
                                              'shipped', 'delivered', 'cancelled', 'expired', 'refunded')),
  fulfillment             text NOT NULL CHECK (fulfillment IN ('drop_off', 'ship')),
  ship_to                 jsonb NOT NULL,              -- address snapshot at checkout
  ship_zip                text NOT NULL CHECK (ship_zip ~ '^[0-9]{5}$'),
  ruo_accepted_at         timestamptz NOT NULL,
  subtotal_cents          integer NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents          integer NOT NULL CHECK (shipping_cents >= 0),
  tax_rate                numeric(6,5) NOT NULL CHECK (tax_rate >= 0 AND tax_rate < 0.2),
  tax_cents               integer NOT NULL CHECK (tax_cents >= 0),
  total_cents             integer NOT NULL,
  reservation_expires_at  timestamptz,
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (total_cents = subtotal_cents + shipping_cents + tax_cents),
  CHECK (status <> 'pending_payment' OR reservation_expires_at IS NOT NULL)
);
CREATE INDEX orders_customer ON orders (customer_id, created_at DESC);
CREATE INDEX orders_status ON orders (status, created_at DESC);
CREATE INDEX orders_pending_expiry
  ON orders (reservation_expires_at) WHERE status = 'pending_payment';
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id        uuid NOT NULL REFERENCES variants(id),
  vendor_id         uuid NOT NULL REFERENCES vendors(id),
  product_name      text NOT NULL,                     -- snapshot
  variant_label     text NOT NULL,                     -- snapshot
  qty               integer NOT NULL CHECK (qty > 0),
  unit_price_cents  integer NOT NULL CHECK (unit_price_cents > 0),
  UNIQUE (order_id, variant_id)
);

CREATE TABLE stock_movements (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id  uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  delta       integer NOT NULL CHECK (delta <> 0),
  reason      text NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment', 'return')),
  order_id    uuid REFERENCES orders(id),
  note        text,
  created_by  uuid REFERENCES customers(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (reason <> 'adjustment' OR note IS NOT NULL)
);
CREATE INDEX stock_movements_variant ON stock_movements (variant_id, created_at DESC);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id),
  provider        text NOT NULL CHECK (provider IN ('paypal', 'stripe')),
  provider_ref    text NOT NULL,                       -- PayPal order / capture id
  amount_cents    integer NOT NULL CHECK (amount_cents >= 0),
  fee_cents       integer NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  refunded_cents  integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  status          text NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created', 'captured', 'failed', 'refunded', 'partially_refunded')),
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref),
  CHECK (refunded_cents <= amount_cents)
);
CREATE INDEX payments_order ON payments (order_id);
CREATE TRIGGER payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One shipment per vendor in an order; carries that vendor's shipping charge.
CREATE TABLE shipments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  vendor_id        uuid NOT NULL REFERENCES vendors(id),
  method           text NOT NULL CHECK (method IN ('drop_off', 'ship')),
  rate_cents       integer NOT NULL CHECK (rate_cents >= 0),
  carrier          text,
  tracking_number  text,
  drop_off_window  tstzrange,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'packed', 'out_for_delivery', 'shipped', 'delivered')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, vendor_id)
);
CREATE TRIGGER shipments_updated_at BEFORE UPDATE ON shipments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Tax
-- ---------------------------------------------------------------------------

-- Combined state + local rate per ZIP, loaded from Avalara's free monthly tables.
CREATE TABLE tax_rates (
  zip             text NOT NULL CHECK (zip ~ '^[0-9]{5}$'),
  state           char(2) NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  county          text,
  combined_rate   numeric(6,5) NOT NULL CHECK (combined_rate >= 0 AND combined_rate < 0.2),
  effective_from  date NOT NULL,
  source          text NOT NULL DEFAULT 'avalara',
  PRIMARY KEY (zip, effective_from)
);
