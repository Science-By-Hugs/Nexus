import { hmacSha256Hex } from "./crypto.ts";
import { readJson } from "./http.ts";

// Contract and Apps Script verification steps: docs/INVOICE-BRIDGE.md.

const MIN_SECRET_LENGTH = 32;
const DEFAULT_ALLOWED_HOSTS = "script.google.com";

export type InvoiceBridge = { url: URL; secret: string };

// Returns null unless the bridge secret is set and the configured URL is an
// HTTPS address on the host allowlist. The allowlist lives in Edge Function
// secrets, so editing internal_runtime_config alone cannot redirect requests.
export function resolveInvoiceBridge(
  configuredUrl: unknown,
  secret: string | undefined,
  allowedHosts: string | undefined,
): InvoiceBridge | null {
  const bridgeSecret = String(secret || "");
  if (bridgeSecret.length < MIN_SECRET_LENGTH) return null;

  const hosts = String(allowedHosts || DEFAULT_ALLOWED_HOSTS)
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);

  let url: URL;
  try {
    url = new URL(String(configuredUrl || "").trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.includes(url.hostname.toLowerCase())
  ) {
    return null;
  }

  return { url, secret: bridgeSecret };
}

export function invoiceBridgeFromEnv(configuredUrl: unknown) {
  return resolveInvoiceBridge(
    configuredUrl,
    Deno.env.get("INVOICE_BRIDGE_SECRET"),
    Deno.env.get("INVOICE_BRIDGE_ALLOWED_HOSTS"),
  );
}

// Escapes non-ASCII characters so the signed bytes are the same however the
// receiver decodes the body. The JSON value is unchanged.
const asciiJson = (value: unknown) =>
  JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"),
  );

// Apps Script web apps cannot read request headers, so the timestamp and
// signature travel as query parameters. The signature covers the timestamp,
// the API name and the exact body, and carries no reusable secret.
export async function postToInvoiceBridge(
  bridge: InvoiceBridge,
  api: string,
  payload: Record<string, unknown>,
  now = Date.now(),
) {
  const body = asciiJson(payload);
  const timestamp = String(Math.floor(now / 1000));
  const signature = await hmacSha256Hex(bridge.secret, `${timestamp}.${api}.${body}`);

  const url = new URL(bridge.url);
  url.searchParams.set("api", api);
  url.searchParams.set("ts", timestamp);
  url.searchParams.set("sig", signature);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    redirect: "follow",
  });

  return { response, data: await readJson(response) };
}
