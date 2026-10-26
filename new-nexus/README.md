# New NEXUS

The reinvented NEXUS: a research-use-only store for verified researchers, with a website, iOS/Android app, PayPal checkout and an admin dashboard. It replaces the current NEXUS; items from the old catalog come over only when hand-picked in the admin import.

Build plan: the "SBH Supplies Store Build Plan" doc. This folder lives on the `new-nexus` branch and nothing here is deployed or merged without owner approval.

## Layout

| Path | What it is |
| --- | --- |
| `db/migrations/` | Neon Postgres schema and store logic, applied in order |
| `db/tests/` | SQL behaviour tests (stock, checkout pricing, tax, payments, researcher approval) |
| `db/migrate.sh` | Applies pending migrations; safe to re-run |
| `db/run-tests.sh` | Builds a throwaway database, migrates it twice, runs the tests |
| `api/` | Cloudflare Worker API (Neon serverless driver, no framework) |

Coming next (build plan phases 2–5): admin dashboard, Expo storefront (web + iOS + Android), PayPal checkout.

## How the rules are enforced

- **Verified researchers only.** A database trigger refuses any order from a customer who is not approved, whatever code path inserts it. Approval is manual, by an admin.
- **Research-use terms.** `create_order` refuses checkout unless the terms were accepted, and stores the time on the order.
- **Stock.** Checkout reserves stock for 30 minutes; payment converts the hold into a sale. Unpaid holds are released lazily on the next checkout, so no cron wakes the database. Admin adjustments can never cut stock below what is reserved, and every change is logged in `stock_movements`.
- **Shipping.** Each vendor has its own drop-off and ship rate. A cart with items from two vendors pays each vendor's rate and gets one shipment per vendor.
- **Tax.** Charged by delivery ZIP from `tax_rates` (loaded from Avalara's free monthly ZIP tables). A Nevada ZIP with no loaded rate blocks checkout instead of charging 0%. Shipping is not taxed. Out-of-state orders collect no tax by default.
- **Payments.** `mark_order_paid` is safe to call twice (webhook retries), rejects amounts that don't match the order, and flags a late payment for review instead of overselling.

## Staying inside Neon's free compute

- Compute fixed at 0.25 CU, no autoscaling.
- `/health` never queries the database; `/catalog` and `/tax` are cached at Cloudflare's edge (5 minutes and 1 day), so browsing rarely wakes Neon.
- Staging is a separate Neon project with its own 100 compute-hours.

## Running locally

```bash
# Database tests (needs a local Postgres 16+; never point at Neon)
ADMIN_DATABASE_URL=postgres://postgres@localhost:5432/postgres ./new-nexus/db/run-tests.sh

# API
cd new-nexus/api
npm install
npm run typecheck
npm test
```

## Setting up staging (needs owner approval)

1. Create a Neon project `new-nexus-staging` (free plan, region US West), compute fixed at 0.25 CU.
2. Apply migrations with the **direct** connection string: `DATABASE_URL=... ./new-nexus/db/migrate.sh`
3. Enable Neon Auth on the project and copy its JWKS URL and issuer into `api/wrangler.toml` under `[env.staging.vars]`.
4. `cd new-nexus/api && npx wrangler secret put DATABASE_URL --env staging` with the **pooled** connection string.
5. Make your own account an admin after first sign-in: `UPDATE customers SET role = 'admin' WHERE email = '<your email>';`

To check during staging: that Neon Auth tokens carry an `email` claim (the API requires it to create the customer record).
