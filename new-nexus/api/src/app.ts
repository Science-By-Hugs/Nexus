import { bearer, type Identity } from './auth';
import type { Db } from './db';
import { HttpError, Router, errorResponse, json, readJson, requireText, requireUuid } from './http';

export interface Deps {
  db: Db;
  verify: (token: string) => Promise<Identity>;
  allowedOrigins: string[];
  // Edge cache for public reads; null in tests. Cached responses never wake Neon.
  cache: Cache | null;
  waitUntil: (p: Promise<unknown>) => void;
  log: (event: string, data: Record<string, unknown>) => void;
}

interface Customer {
  id: string;
  email: string;
  name: string | null;
  role: 'customer' | 'admin';
  verification_status: 'unsubmitted' | 'pending' | 'approved' | 'rejected';
  approved_at: string | null;
}

const CATALOG_TTL = 300; // seconds; checkout re-checks live stock anyway
const TAX_TTL = 86_400; // rates change at most monthly

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

// First authenticated request creates the customer row (unverified).
async function currentCustomer(req: Request, deps: Deps): Promise<Customer> {
  const identity = await deps.verify(bearer(req));
  const rows = await deps.db.query<Customer>(
    `INSERT INTO customers (auth_user_id, email)
     VALUES ($1, $2)
     ON CONFLICT (auth_user_id) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email, name, role, verification_status, approved_at`,
    [identity.sub, identity.email],
  );
  const customer = rows[0];
  if (!customer) throw new HttpError(500, 'customer_upsert_failed');
  return customer;
}

async function currentAdmin(req: Request, deps: Deps): Promise<Customer> {
  const customer = await currentCustomer(req, deps);
  if (customer.role !== 'admin') throw new HttpError(403, 'admin_only');
  return customer;
}

// ---------------------------------------------------------------------------
// Edge caching for public reads
// ---------------------------------------------------------------------------

async function cached(req: Request, deps: Deps, ttl: number, build: () => Promise<Response>): Promise<Response> {
  const key = new Request(new URL(req.url).toString(), { method: 'GET' });
  if (deps.cache) {
    const hit = await deps.cache.match(key);
    if (hit) return hit;
  }
  const res = await build();
  if (res.ok) {
    res.headers.set('cache-control', `public, max-age=${ttl}`);
    if (deps.cache) deps.waitUntil(deps.cache.put(key, res.clone()));
  }
  return res;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function buildRouter(): Router<Deps> {
  const r = new Router<Deps>();

  // Does not touch the database, so uptime checks never wake Neon.
  r.get('/health', async () => json({ ok: true }));

  r.get('/catalog', async (req, deps) =>
    cached(req, deps, CATALOG_TTL, async () => {
      const products = await deps.db.query(
        `SELECT p.id, p.slug, p.name, p.description, p.category, p.ruo,
                coalesce(json_agg(json_build_object(
                  'id', v.id, 'sku', v.sku, 'label', v.label, 'price_cents', v.price_cents,
                  'image_keys', v.image_keys,
                  'in_stock', coalesce(i.on_hand - i.reserved, 0) > 0
                ) ORDER BY v.price_cents) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
         FROM products p
         LEFT JOIN variants v ON v.product_id = p.id AND v.active
         LEFT JOIN inventory i ON i.variant_id = v.id
         WHERE p.status = 'active'
         GROUP BY p.id
         ORDER BY p.name`,
      );
      return json({ products, notice: 'All products are for research use only. Not for human or veterinary use.' });
    }),
  );

  r.get('/tax', async (req, deps) => {
    const url = new URL(req.url);
    const zip = url.searchParams.get('zip') ?? '';
    const state = (url.searchParams.get('state') ?? '').toUpperCase();
    if (!/^[0-9]{5}$/.test(zip) || !/^[A-Z]{2}$/.test(state)) {
      throw new HttpError(400, 'invalid_address', 'zip (5 digits) and state (2 letters) are required');
    }
    return cached(req, deps, TAX_TTL, async () => {
      const rows = await deps.db.query<{ rate: string }>('SELECT order_tax_rate($1, $2)::text AS rate', [zip, state]);
      return json({ zip, state, rate: Number(rows[0]?.rate ?? 0) });
    });
  });

  r.get('/me', async (req, deps) => json({ customer: await currentCustomer(req, deps) }));

  r.post('/me/application', async (req, deps) => {
    const customer = await currentCustomer(req, deps);
    const body = await readJson<{ institution?: unknown; role_title?: unknown; document_key?: unknown }>(req);
    const institution = requireText(body.institution, 'institution');
    const roleTitle = requireText(body.role_title, 'role_title');
    let documentKey: string | null = null;
    if (body.document_key !== undefined && body.document_key !== null) {
      documentKey = requireText(body.document_key, 'document_key', 300);
      // Uploads land under the customer's own prefix; refuse anything else.
      if (!documentKey.startsWith(`applications/${customer.id}/`)) {
        throw new HttpError(400, 'invalid_field', 'document_key must be one of your own uploads');
      }
    }
    const rows = await deps.db.query<{ id: string }>(
      'SELECT submit_researcher_application($1, $2, $3, $4) AS id',
      [customer.id, institution, roleTitle, documentKey],
    );
    deps.log('application_submitted', { customer_id: customer.id });
    return json({ application_id: rows[0]?.id, status: 'pending' }, { status: 201 });
  });

  r.get('/admin/applications', async (req, deps) => {
    await currentAdmin(req, deps);
    const applications = await deps.db.query(
      `SELECT a.id, a.institution, a.role_title, a.document_key, a.submitted_at,
              c.id AS customer_id, c.email, c.name
       FROM researcher_applications a JOIN customers c ON c.id = a.customer_id
       WHERE a.status = 'pending'
       ORDER BY a.submitted_at`,
    );
    return json({ applications });
  });

  r.post('/admin/applications/:id/decision', async (req, deps, params) => {
    const admin = await currentAdmin(req, deps);
    const id = requireUuid(params.id, 'application id');
    const body = await readJson<{ approve?: unknown; notes?: unknown }>(req);
    if (typeof body.approve !== 'boolean') throw new HttpError(400, 'invalid_field', 'approve must be true or false');
    const notes = body.notes == null ? null : requireText(body.notes, 'notes', 1000);
    const rows = await deps.db.query<{ status: string }>(
      'SELECT decide_researcher_application($1, $2, $3, $4) AS status',
      [id, admin.id, body.approve, notes],
    );
    deps.log('application_decided', { application_id: id, status: rows[0]?.status });
    return json({ application_id: id, status: rows[0]?.status });
  });

  r.get('/admin/inventory', async (req, deps) => {
    await currentAdmin(req, deps);
    const items = await deps.db.query('SELECT * FROM inventory_status ORDER BY low_stock DESC, product_name, variant_label');
    return json({ items });
  });

  r.post('/admin/inventory/:variantId/adjust', async (req, deps, params) => {
    const admin = await currentAdmin(req, deps);
    const variantId = requireUuid(params.variantId, 'variant id');
    const body = await readJson<{ delta?: unknown; reason?: unknown; note?: unknown }>(req);
    if (!Number.isInteger(body.delta) || body.delta === 0 || Math.abs(body.delta as number) > 100_000) {
      throw new HttpError(400, 'invalid_field', 'delta must be a non-zero whole number');
    }
    if (body.reason !== 'restock' && body.reason !== 'adjustment' && body.reason !== 'return') {
      throw new HttpError(400, 'invalid_field', 'reason must be restock, adjustment or return');
    }
    const note = body.note == null ? null : requireText(body.note, 'note', 500);
    if (body.reason === 'adjustment' && !note) {
      throw new HttpError(400, 'invalid_field', 'adjustments need a note');
    }
    const rows = await deps.db.query<{ on_hand: number }>(
      'SELECT adjust_stock($1, $2, $3, $4, $5) AS on_hand',
      [variantId, body.delta, body.reason, note, admin.id],
    );
    return json({ variant_id: variantId, on_hand: rows[0]?.on_hand });
  });

  return r;
}

// ---------------------------------------------------------------------------
// Request handling: CORS, routing, error mapping
// ---------------------------------------------------------------------------

function corsHeaders(req: Request, allowed: string[]): Headers {
  const headers = new Headers();
  const origin = req.headers.get('origin');
  if (origin && allowed.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-headers', 'authorization, content-type');
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
    headers.set('access-control-max-age', '86400');
    headers.set('vary', 'origin');
  }
  return headers;
}

const router = buildRouter();

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(req, deps.allowedOrigins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  let res: Response;
  try {
    const match = router.match(req.method, new URL(req.url).pathname);
    if (match === null) throw new HttpError(404, 'not_found');
    if (match === 'method') throw new HttpError(405, 'method_not_allowed');
    res = await match.handler(req, deps, match.params);
  } catch (err) {
    if (err instanceof HttpError) {
      res = errorResponse(err);
    } else {
      deps.log('unhandled_error', { message: err instanceof Error ? err.message : String(err) });
      res = errorResponse(new HttpError(500, 'internal_error', 'Something went wrong'));
    }
  }
  // Cached responses are immutable; copy before adding per-request headers.
  res = new Response(res.body, res);
  cors.forEach((value, key) => res.headers.set(key, value));
  return res;
}
