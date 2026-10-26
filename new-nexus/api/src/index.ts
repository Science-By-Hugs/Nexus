import { handle } from './app';
import { jwksLoader, verifyJwt } from './auth';
import { neonDb } from './neon';

export interface Env {
  APP_ENV: 'staging' | 'production';
  DATABASE_URL: string; // secret: Neon pooled connection string
  AUTH_JWKS_URL: string;
  AUTH_ISSUER: string;
  AUTH_AUDIENCE?: string;
  ALLOWED_ORIGINS: string; // comma-separated
}

// Built once per isolate so the JWKS cache survives across requests.
let loader: ReturnType<typeof jwksLoader> | null = null;

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    loader ??= jwksLoader(env.AUTH_JWKS_URL);
    const keyLoader = loader;
    return handle(req, {
      db: neonDb(env.DATABASE_URL),
      verify: (token) =>
        verifyJwt(token, { jwksUrl: env.AUTH_JWKS_URL, issuer: env.AUTH_ISSUER, audience: env.AUTH_AUDIENCE }, keyLoader),
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      cache: (caches as unknown as { default: Cache }).default,
      waitUntil: (p) => ctx.waitUntil(p),
      log: (event, data) => console.log(JSON.stringify({ event, env: env.APP_ENV, ...data })),
    });
  },
};
