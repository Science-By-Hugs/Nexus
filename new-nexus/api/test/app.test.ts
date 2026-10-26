import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle, type Deps } from '../src/app';
import type { Identity } from '../src/auth';
import { mapDbError, type Db } from '../src/db';
import { HttpError } from '../src/http';

// A fake database that records SQL and answers by matching on the text.
type Responder = (text: string, params: unknown[]) => unknown[] | undefined;

function setup(opts: { role?: 'customer' | 'admin'; respond?: Responder; tokens?: Record<string, Identity> } = {}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Db = {
    async query<T>(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (text.includes('INSERT INTO customers')) {
        return [{ id: '11111111-1111-4111-8111-111111111111', email: params[1], name: null,
                  role: opts.role ?? 'customer', verification_status: 'unsubmitted', approved_at: null }] as T[];
      }
      const out = opts.respond?.(text, params);
      if (out instanceof Error) throw out;
      return (out ?? []) as T[];
    },
  };
  const tokens = opts.tokens ?? { good: { sub: 'u1', email: 'a@lab.test' } };
  const logs: string[] = [];
  const deps: Deps = {
    db,
    verify: async (t) => {
      const id = tokens[t];
      if (!id) throw new HttpError(401, 'invalid_token');
      return id;
    },
    allowedOrigins: ['https://nexus.test'],
    cache: null,
    waitUntil: () => {},
    log: (e) => logs.push(e),
  };
  const call = (method: string, path: string, init: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    return handle(new Request(`https://api.test${path}`, {
      method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }), deps);
  };
  return { call, calls, logs };
}

const body = async (res: Response) => (await res.json()) as Record<string, any>;
const ADMIN_PATHS: [string, string, unknown?][] = [
  ['GET', '/admin/applications'],
  ['GET', '/admin/inventory'],
  ['POST', '/admin/applications/22222222-2222-4222-8222-222222222222/decision', { approve: true }],
  ['POST', '/admin/inventory/22222222-2222-4222-8222-222222222222/adjust', { delta: 1, reason: 'restock' }],
];

test('health never touches the database', async () => {
  const { call, calls } = setup();
  const res = await call('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('unknown path is 404, wrong method is 405', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('POST', '/catalog')).status, 405);
});

test('catalog is public, cacheable and carries the RUO notice', async () => {
  const { call } = setup({ respond: (t) => (t.includes('FROM products') ? [{ id: 'p1', name: 'Vials' }] : undefined) });
  const res = await call('GET', '/catalog');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /max-age=300/);
  const b = await body(res);
  assert.equal(b.products.length, 1);
  assert.match(b.notice, /research use only/i);
});

test('tax validates input and passes zip/state to order_tax_rate', async () => {
  const { call, calls } = setup({ respond: (t) => (t.includes('order_tax_rate') ? [{ rate: '0.08375' }] : undefined) });
  assert.equal((await call('GET', '/tax?zip=891&state=NV')).status, 400);
  const res = await call('GET', '/tax?zip=89101&state=nv');
  assert.deepEqual(await body(res), { zip: '89101', state: 'NV', rate: 0.08375 });
  assert.deepEqual(calls.at(-1)?.params, ['89101', 'NV']);
});

test('missing tax rate surfaces as 422, not a 0% charge', async () => {
  const { call } = setup({ respond: (t) => (t.includes('order_tax_rate') ? (mapDbError(new Error('tax_rate_missing:89999')) as any) : undefined) });
  const res = await call('GET', '/tax?zip=89999&state=NV');
  assert.equal(res.status, 422);
  assert.equal((await body(res)).error, 'tax_rate_missing');
});

test('/me needs a valid token and creates the customer on first call', async () => {
  const { call, calls } = setup();
  assert.equal((await call('GET', '/me')).status, 401);
  assert.equal((await call('GET', '/me', { token: 'forged' })).status, 401);
  const res = await call('GET', '/me', { token: 'good' });
  assert.equal(res.status, 200);
  assert.equal((await body(res)).customer.verification_status, 'unsubmitted');
  assert.deepEqual(calls.at(-1)?.params, ['u1', 'a@lab.test']);
});

test('application: validates fields and only accepts the customer\'s own upload key', async () => {
  const { call, calls } = setup({ respond: (t) => (t.includes('submit_researcher_application') ? [{ id: 'app-1' }] : undefined) });
  assert.equal((await call('POST', '/me/application', { token: 'good', body: { institution: ' ', role_title: 'PI' } })).status, 400);
  assert.equal((await call('POST', '/me/application', { token: 'good', body: { institution: 'Lab', role_title: 'PI', document_key: 'applications/someone-else/id.pdf' } })).status, 400);
  const res = await call('POST', '/me/application', {
    token: 'good',
    body: { institution: ' Lab ', role_title: 'PI', document_key: 'applications/11111111-1111-4111-8111-111111111111/id.pdf' },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(calls.at(-1)?.params, ['11111111-1111-4111-8111-111111111111', 'Lab', 'PI', 'applications/11111111-1111-4111-8111-111111111111/id.pdf']);
});

test('application already pending maps to 409', async () => {
  const { call } = setup({ respond: (t) => (t.includes('submit_researcher_application') ? (mapDbError(new Error('application_pending')) as any) : undefined) });
  const res = await call('POST', '/me/application', { token: 'good', body: { institution: 'Lab', role_title: 'PI' } });
  assert.equal(res.status, 409);
});

test('every admin route rejects anonymous and non-admin callers', async () => {
  const { call, calls } = setup({ role: 'customer' });
  for (const [method, path, b] of ADMIN_PATHS) {
    assert.equal((await call(method, path, { body: b })).status, 401, `${path} anonymous`);
    assert.equal((await call(method, path, { token: 'good', body: b })).status, 403, `${path} customer`);
  }
  // Non-admins never reach anything beyond the customer lookup.
  assert.ok(calls.every((c) => c.text.includes('INSERT INTO customers')));
});

test('admin decision validates and passes the admin id', async () => {
  const { call, calls } = setup({ role: 'admin', respond: (t) => (t.includes('decide_researcher_application') ? [{ status: 'approved' }] : undefined) });
  const path = '/admin/applications/22222222-2222-4222-8222-222222222222/decision';
  assert.equal((await call('POST', '/admin/applications/not-a-uuid/decision', { token: 'good', body: { approve: true } })).status, 400);
  assert.equal((await call('POST', path, { token: 'good', body: { approve: 'yes' } })).status, 400);
  const res = await call('POST', path, { token: 'good', body: { approve: true, notes: 'checked ID' } });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.at(-1)?.params, ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', true, 'checked ID']);
});

test('stock adjustment rules', async () => {
  const { call } = setup({ role: 'admin', respond: (t) => (t.includes('adjust_stock') ? [{ on_hand: 7 }] : undefined) });
  const path = '/admin/inventory/22222222-2222-4222-8222-222222222222/adjust';
  assert.equal((await call('POST', path, { token: 'good', body: { delta: 0, reason: 'restock' } })).status, 400);
  assert.equal((await call('POST', path, { token: 'good', body: { delta: 1.5, reason: 'restock' } })).status, 400);
  assert.equal((await call('POST', path, { token: 'good', body: { delta: 1, reason: 'sale' } })).status, 400);
  assert.equal((await call('POST', path, { token: 'good', body: { delta: -1, reason: 'adjustment' } })).status, 400);
  const res = await call('POST', path, { token: 'good', body: { delta: 5, reason: 'restock' } });
  assert.deepEqual(await body(res), { variant_id: '22222222-2222-4222-8222-222222222222', on_hand: 7 });
});

test('POST without JSON content type is refused', async () => {
  const { call } = setup();
  const res = await call('POST', '/me/application', { token: 'good', headers: { 'content-type': 'text/plain' } });
  assert.equal(res.status, 415);
});

test('unexpected errors are logged and hidden from the client', async () => {
  const { call, logs } = setup({ respond: (t) => (t.includes('FROM products') ? (new Error('connection reset at 10.0.0.5') as any) : undefined) });
  const res = await call('GET', '/catalog');
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(await body(res)), /10\.0\.0\.5/);
  assert.deepEqual(logs, ['unhandled_error']);
});

test('CORS only for allowed origins; preflight answered', async () => {
  const { call } = setup();
  const ok = await call('GET', '/health', { headers: { origin: 'https://nexus.test' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://nexus.test');
  const bad = await call('GET', '/health', { headers: { origin: 'https://evil.test' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await call('OPTIONS', '/me/application', { headers: { origin: 'https://nexus.test' } });
  assert.equal(pre.status, 204);
});
