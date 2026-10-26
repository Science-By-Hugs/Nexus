import { HttpError } from './http';

// Everything the API needs from the database: parameterised SQL in, rows out.
// Routes depend on this interface, so tests can swap in a fake.
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

// Store functions raise stable codes such as 'insufficient_stock:<ids>'.
// Map the known ones to HTTP responses; anything else is a 500.
const KNOWN: Record<string, number> = {
  researcher_not_approved: 403,
  ruo_terms_not_accepted: 400,
  invalid_fulfillment: 400,
  invalid_address: 400,
  empty_cart: 400,
  item_unavailable: 409,
  invalid_quantity: 400,
  insufficient_stock: 409,
  shipping_rate_missing: 409,
  tax_rate_missing: 422,
  already_approved: 409,
  application_pending: 409,
  application_not_pending: 409,
  not_admin: 403,
  customer_not_found: 404,
  stock_below_reserved: 409,
  invalid_reason: 400,
};

export function mapDbError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const code = message.split(':', 1)[0]?.trim() ?? '';
  const status = KNOWN[code];
  if (status) return new HttpError(status, code, message);
  return err instanceof Error ? err : new Error(message);
}
