import { readJson } from "./http.ts";

export const WALLET_CREATED_STATUSES = ["paypal_created", "venmo_created", "applepay_created"];

// PayPal order states in which the payer has not approved the order, so the
// payment row may be replaced by another provider without losing a payment.
const UNAPPROVED_PAYPAL_ORDER_STATUSES = ["CREATED", "PAYER_ACTION_REQUIRED", "VOIDED"];

export function paypalBaseUrl() {
  return (Deno.env.get("PAYPAL_ENV") || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export async function getAccessToken() {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID") || "";
  const secret = Deno.env.get("PAYPAL_CLIENT_SECRET") || "";
  if (!clientId || !secret) throw new Error("PayPal credentials are not configured");

  const auth = btoa(`${clientId}:${secret}`);
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await readJson(response);
  if (!response.ok || !data?.access_token) {
    throw new Error("Could not authenticate with PayPal");
  }

  return data.access_token as string;
}

// True only when PayPal confirms the payer never approved this order. Any
// lookup failure returns false so callers keep the existing payment row.
export async function paypalOrderIsUnapproved(accessToken: string, paypalOrderId: string) {
  try {
    const response = await fetch(
      `${paypalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const data = await readJson(response);
    return response.ok && UNAPPROVED_PAYPAL_ORDER_STATUSES.includes(String(data?.status || ""));
  } catch {
    return false;
  }
}
