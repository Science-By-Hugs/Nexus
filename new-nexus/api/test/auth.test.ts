import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jwksLoader, verifyJwt } from '../src/auth';
import { HttpError } from '../src/http';

const ISSUER = 'https://auth.test.invalid';
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function makeSigner(alg: 'RS256' | 'ES256') {
  const params =
    alg === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: `k-${alg}` };
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = {}) => {
    const h = enc({ alg, kid: jwk.kid, typ: 'JWT', ...header });
    const p = enc(claims);
    const sigAlg = alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
    const sig = await crypto.subtle.sign(sigAlg, pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
  };
  return { jwk, sign };
}

function fakeJwks(keys: object[]) {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetcher, calls: () => calls };
}

const now = 1_800_000_000;
const good = { sub: 'user-1', email: 'Researcher@Lab.test', iss: ISSUER, exp: now + 600 };

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (e: unknown) => e instanceof HttpError && e.code === code);
}

for (const alg of ['RS256', 'ES256'] as const) {
  test(`${alg}: valid token returns identity with lower-cased email`, async () => {
    const s = await makeSigner(alg);
    const loader = jwksLoader('https://jwks', fakeJwks([s.jwk]).fetcher);
    const id = await verifyJwt(await s.sign(good), { jwksUrl: '', issuer: ISSUER }, loader, now);
    assert.deepEqual(id, { sub: 'user-1', email: 'researcher@lab.test' });
  });
}

test('rejects tampered payload', async () => {
  const s = await makeSigner('ES256');
  const loader = jwksLoader('https://jwks', fakeJwks([s.jwk]).fetcher);
  const [h, , sig] = (await s.sign(good)).split('.');
  const forged = `${h}.${enc({ ...good, sub: 'admin' })}.${sig}`;
  await rejects(verifyJwt(forged, { jwksUrl: '', issuer: ISSUER }, loader, now), 'invalid_token');
});

test('rejects a token signed by a key not in the JWKS', async () => {
  const trusted = await makeSigner('ES256');
  const attacker = await makeSigner('ES256');
  const loader = jwksLoader('https://jwks', fakeJwks([trusted.jwk]).fetcher);
  // Same kid as the trusted key, different private key.
  await rejects(verifyJwt(await attacker.sign(good), { jwksUrl: '', issuer: ISSUER }, loader, now), 'invalid_token');
});

test('rejects expired, wrong issuer, wrong audience, alg none, missing email', async () => {
  const s = await makeSigner('RS256');
  const loader = jwksLoader('https://jwks', fakeJwks([s.jwk]).fetcher);
  const cfg = { jwksUrl: '', issuer: ISSUER };
  await rejects(verifyJwt(await s.sign({ ...good, exp: now - 120 }), cfg, loader, now), 'token_expired');
  await rejects(verifyJwt(await s.sign({ ...good, iss: 'https://evil' }), cfg, loader, now), 'invalid_token');
  await rejects(verifyJwt(await s.sign(good), { ...cfg, audience: 'nexus' }, loader, now), 'invalid_token');
  assert.ok(await verifyJwt(await s.sign({ ...good, aud: ['x', 'nexus'] }), { ...cfg, audience: 'nexus' }, loader, now));
  await rejects(verifyJwt(await s.sign(good, { alg: 'none' }), cfg, loader, now), 'invalid_token');
  await rejects(verifyJwt(await s.sign({ ...good, email: undefined }), cfg, loader, now), 'invalid_token');
  await rejects(verifyJwt('not.a.jwt.at.all', cfg, loader, now), 'invalid_token');
});

test('JWKS is fetched once and cached', async () => {
  const s = await makeSigner('ES256');
  const jwks = fakeJwks([s.jwk]);
  const loader = jwksLoader('https://jwks', jwks.fetcher);
  const token = await s.sign(good);
  await verifyJwt(token, { jwksUrl: '', issuer: ISSUER }, loader, now);
  await verifyJwt(token, { jwksUrl: '', issuer: ISSUER }, loader, now);
  assert.equal(jwks.calls(), 1);
});
