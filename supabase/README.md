# Supabase backend (partial)

This folder holds only part of the backend the app depends on. It was inherited from NEXUS 1.0. The 2.0 staging backend source is kept outside this repository (`v2/backend/`; see [docs/V2-STAGING-PLAN.md](../docs/V2-STAGING-PLAN.md)).

## Edge Functions the app calls

| Function | In this repo |
| --- | --- |
| `create-checkout-order`, `paypal-create-order`, `paypal-capture-order`, `app-push` | Yes |
| `zelle-config`, `zelle-submit-payment` | Yes (the 2.0 client disables Zelle) |
| `discount-code`, `paypal-config`, `request-invoice`, `invoice-pdf-link`, `referral-claim`, `referral-dashboard`, `referral-submit`, `claim-existing-profile`, `complete-apple-profile`, `native-push` | No |

`create-checkout-order` calls the deployed `discount-code` function server-to-server with the customer's `Authorization` header and the server-calculated `{ code, subtotal, shipping }`. It relies on the response shape the client already uses: `{ success, discount: { valid, code, kind, discountPercent, shippingDiscount, error? } }`.

## Database

Migrations here cover marketing consent and the profile column guard only. The schema and RLS for `profiles`, `orders`, `order_items`, `payments`, `invoices`, `products`, `memberships`, `referrals`, `internal_runtime_config` and the `avatars` bucket are not in this repository.

To bring the repository in line with a project (requires project access):

```bash
supabase functions download <name> --project-ref <ref>   # for each missing function
supabase db pull --project-ref <ref>                      # schema and RLS baseline
```

## Edge Function secrets used here

`PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ZELLE_DISPLAY_NAME`, `ZELLE_CONTACT`, `ZELLE_QR_URL`, `INVOICE_BRIDGE_SECRET` and optional `INVOICE_BRIDGE_ALLOWED_HOSTS` (see [docs/INVOICE-BRIDGE.md](../docs/INVOICE-BRIDGE.md)).

## Tests

`npm test` runs the Edge Function contract tests (`tests/checkout-functions.test.cjs`) in Node with an in-memory Supabase client and scripted PayPal, discount and bridge responses. They do not exercise a real database or provider.
