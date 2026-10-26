// Minimal router and JSON helpers. Kept dependency-free so the Worker bundle
// stays small and the only third-party runtime code is the Neon driver.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(err: HttpError): Response {
  return json({ error: err.code, message: err.message }, { status: err.status });
}

export async function readJson<T>(req: Request): Promise<T> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    throw new HttpError(415, 'json_required');
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

export type Params = Record<string, string>;
export type Handler<C> = (req: Request, ctx: C, params: Params) => Promise<Response>;

interface Route<C> {
  method: string;
  parts: string[];
  handler: Handler<C>;
}

export class Router<C> {
  private routes: Route<C>[] = [];

  on(method: string, path: string, handler: Handler<C>): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
    return this;
  }

  get(path: string, h: Handler<C>) {
    return this.on('GET', path, h);
  }
  post(path: string, h: Handler<C>) {
    return this.on('POST', path, h);
  }

  match(method: string, pathname: string): { handler: Handler<C>; params: Params } | 'method' | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchParts(route.parts, parts);
      if (!params) continue;
      pathMatched = true;
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { handler: route.handler, params };
      }
    }
    return pathMatched ? 'method' : null;
  }
}

function matchParts(pattern: string[], actual: string[]): Params | null {
  if (pattern.length !== actual.length) return null;
  const params: Params = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern.at(i)!;
    const a = actual.at(i)!;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string | undefined, field: string): string {
  if (!value || !UUID.test(value)) throw new HttpError(400, 'invalid_id', `${field} must be a UUID`);
  return value.toLowerCase();
}

export function requireText(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new HttpError(400, 'invalid_field', `${field} is required (max ${max} characters)`);
  }
  return value.trim();
}
