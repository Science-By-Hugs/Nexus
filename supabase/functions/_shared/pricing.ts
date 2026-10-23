// Checkout pricing shared by the NEXUS cart preview (Vite) and the checkout
// Edge Functions (Deno). Keep this file free of runtime-specific APIs and
// imports so both can load it unchanged.

export const MAX_CART_LINES = 5;
export const MAX_LINE_QUANTITY = 99;
export const TAX_RATE = 0.08;
export const WALLET_PROCESSING_FEE_RATE = 0.05;

export type CheckoutPaymentMethod = "PayPal" | "Venmo" | "Apple Pay" | "Zelle";
export type DiscountKind = "free_shipping" | "referral_bonus" | "new_customer" | "group_buy";

export type PricingDiscount = {
  kind: DiscountKind;
  discountPercent?: number | null;
  shippingDiscount?: number | null;
};

export type PricingLine = {
  unitPrice: number;
  quantity: number;
  shippingFrom?: string | null;
};

export type PricingInput = {
  lines: PricingLine[];
  shippingRates: Record<string, number>;
  foundingMember: boolean;
  foundingMemberFreeShippingSource?: string | null;
  discount?: PricingDiscount | null;
  paymentMethod?: CheckoutPaymentMethod | null;
};

export type PricingTotals = {
  subtotal: number;
  discount: number;
  shippingDiscount: number;
  totalSavings: number;
  shipping: number;
  processingFee: number;
  tax: number;
  total: number;
};

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

export function isWalletPayment(method?: string | null) {
  return method === "PayPal" || method === "Venmo" || method === "Apple Pay";
}

export function calculateTotals(input: PricingInput): PricingTotals {
  const subtotal = roundMoney(input.lines.reduce(
    (sum, line) => sum + roundMoney(Number(line.unitPrice || 0) * Number(line.quantity || 0)),
    0,
  ));

  const freeSource = String(input.foundingMemberFreeShippingSource || "").trim().toLowerCase();
  const shippingSources = new Set(
    input.lines.map(line => String(line.shippingFrom || "").trim()).filter(Boolean),
  );

  let baseShipping = 0;
  for (const source of shippingSources) {
    if (input.foundingMember && freeSource && source.toLowerCase() === freeSource) continue;
    baseShipping += Number(input.shippingRates[source] || 0);
  }
  baseShipping = roundMoney(baseShipping);

  const applied = input.discount || null;
  const percent = Math.min(100, Math.max(0, Number(applied?.discountPercent || 0)));
  const discount = applied && applied.kind !== "free_shipping"
    ? roundMoney(subtotal * percent / 100)
    : 0;
  const shippingDiscount = applied?.kind === "free_shipping"
    ? roundMoney(Math.min(baseShipping, Math.max(0, Number(applied.shippingDiscount || 0))))
    : 0;
  const shipping = roundMoney(baseShipping - shippingDiscount);

  const taxableMerchandise = roundMoney(Math.max(0, subtotal - discount));
  const processingFee = isWalletPayment(input.paymentMethod)
    ? roundMoney(taxableMerchandise * WALLET_PROCESSING_FEE_RATE)
    : 0;
  const tax = roundMoney((taxableMerchandise + processingFee) * TAX_RATE);
  const total = roundMoney(subtotal - discount + shipping + processingFee + tax);

  return {
    subtotal,
    discount,
    shippingDiscount,
    totalSavings: roundMoney(discount + shippingDiscount),
    shipping,
    processingFee,
    tax,
    total,
  };
}
