import { HttpError } from './http';

// Verifies the bearer JWT issued by Neon Auth against its JWKS, using only
// WebCrypto. Supports RS256 and ES256, the algorithms JWKS providers use.

export interface AuthConfig {
  jwksUrl: string;
  issuer: string;
  audience?: string;
}

export interface Identity {
  sub: string;
  email: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

type KeyLoader = (kid: string, alg: string) => Promise<CryptoKey>;

// Plain object shapes: the DOM names for these (RsaHashedImportParams etc.)
// do not exist in the Workers type set.
interface AlgSpec {
  import: { name: string; hash?: string; namedCurve?: string };
  verify: { name: string; hash?: string };
}

const ALGS: Record<string, AlgSpec> = {
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
  },
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
  },
};

// Caches keys per isolate for 10 minutes so most requests skip the JWKS fetch.
export function jwksLoader(url: string, fetcher: typeof fetch = fetch): KeyLoader {
  let cache: { at: number; keys: Jwk[] } | null = null;
  return async (kid, alg) => {
    const fresh = cache && Date.now() - cache.at < 600_000;
    let jwk = fresh ? cache!.keys.find((k) => k.kid === kid) : undefined;
    if (!jwk) {
      const res = await fetcher(url);
      if (!res.ok) throw new HttpError(503, 'auth_unavailable');
      const body = (await res.json()) as { keys?: Jwk[] };
      cache = { at: Date.now(), keys: body.keys ?? [] };
      jwk = cache.keys.find((k) => k.kid === kid);
    }
    if (!jwk) throw new HttpError(401, 'invalid_token', 'unknown signing key');
    const spec = ALGS[alg];
    if (!spec) throw new HttpError(401, 'invalid_token', 'unsupported algorithm');
    return crypto.subtle.importKey('jwk', jwk, spec.import, false, ['verify']);
  };
}

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(input.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodePart<T>(part: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
  } catch {
    throw new HttpError(401, 'invalid_token', 'malformed token');
  }
}

export async function verifyJwt(
  token: string,
  config: AuthConfig,
  loadKey: KeyLoader,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Identity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'invalid_token', 'malformed token');
  const [h, p, s] = parts as [string, string, string];

  const header = decodePart<{ alg?: string; kid?: string }>(h);
  if (!header.alg || !ALGS[header.alg] || !header.kid) {
    throw new HttpError(401, 'invalid_token', 'unsupported token header');
  }

  const key = await loadKey(header.kid, header.alg);
  const ok = await crypto.subtle.verify(
    ALGS[header.alg]!.verify,
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new HttpError(401, 'invalid_token', 'bad signature');

  const claims = decodePart<{ sub?: string; email?: string; iss?: string; aud?: string | string[]; exp?: number; nbf?: number }>(p);
  const skew = 60;
  if (typeof claims.exp !== 'number' || claims.exp + skew < nowSeconds) {
    throw new HttpError(401, 'token_expired');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - skew > nowSeconds) {
    throw new HttpError(401, 'invalid_token', 'token not yet valid');
  }
  if (claims.iss !== config.issuer) throw new HttpError(401, 'invalid_token', 'wrong issuer');
  if (config.audience) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(config.audience)) throw new HttpError(401, 'invalid_token', 'wrong audience');
  }
  if (!claims.sub || !claims.email) throw new HttpError(401, 'invalid_token', 'missing subject or email');
  return { sub: claims.sub, email: claims.email.toLowerCase() };
}

export function bearer(req: Request): string {
  const value = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) throw new HttpError(401, 'auth_required');
  return match[1]!;
}
