import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { readJson } from "../_shared/http.ts";
import { invoiceBridgeFromEnv, postToInvoiceBridge } from "../_shared/invoice-bridge.ts";
import { calculateTotals, isWalletPayment, MAX_CART_LINES, MAX_LINE_QUANTITY, roundMoney, type PricingDiscount, type PricingInput, type PricingTotals } from "../_shared/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nexus.sciencebyhugs.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Unpaid checkouts the same customer can pick up again after a retry or reload.
const REUSABLE_PAYMENT_STATUSES = ["pending", "paypal_pending", "venmo_pending", "applepay_pending"];
const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

const itemSignature = (items: Array<{ product_id: string; quantity: number }>) =>
  items.map(item => `${item.product_id}:${Number(item.quantity)}`).sort().join("|");

async function validateDiscountCode(
  supabaseUrl: string,
  publishableKey: string,
  authHeader: string,
  code: string,
  subtotal: number,
  shipping: number,
): Promise<{ discount: PricingDiscount & { code: string } } | { error: string; status: number }> {
  // Reuse the deployed discount-code rules, but with server-calculated amounts.
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/discount-code`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code, subtotal, shipping }),
    });
  } catch {
    return { error: "Discount codes are unavailable right now. Remove the code or try again.", status: 503 };
  }

  const data = await readJson(response);
  if (response.status >= 500 || !data) {
    return { error: "Discount codes are unavailable right now. Remove the code or try again.", status: 503 };
  }
  if (!response.ok || !data.success || !data.discount?.valid) {
    return { error: data.error || data.discount?.error || "Discount code is not valid.", status: 400 };
  }

  return {
    discount: {
      code: String(data.discount.code || code),
      kind: data.discount.kind,
      discountPercent: Number(data.discount.discountPercent || 0),
      shippingDiscount: Number(data.discount.shippingDiscount || 0),
    },
  };
}

async function findReusableOrder(
  admin: ReturnType<typeof createClient<any>>,
  customerId: string,
  paymentMethod: string,
  discountCode: string | null,
  totals: PricingTotals,
  items: Array<{ productId: string; quantity: number }>,
) {
  const { data: candidates, error } = await admin
    .from("orders")
    .select("id,order_number,subtotal,discount_total,shipping_discount_total,discount_code,shipping_total,processing_fee_total,tax_total,total")
    .eq("customer_id", customerId)
    .eq("status", "checkout_pending")
    .eq("payment_method", paymentMethod)
    .in("payment_status", REUSABLE_PAYMENT_STATUSES)
    .gte("created_at", new Date(Date.now() - REUSE_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !candidates?.length) return null;

  const matching = candidates.filter((order: any) =>
    (order.discount_code || null) === discountCode &&
    Number(order.subtotal || 0) === totals.subtotal &&
    Number(order.discount_total || 0) === totals.discount &&
    Number(order.shipping_discount_total || 0) === totals.shippingDiscount &&
    Number(order.shipping_total || 0) === totals.shipping &&
    Number(order.processing_fee_total || 0) === totals.processingFee &&
    Number(order.tax_total || 0) === totals.tax &&
    Number(order.total || 0) === totals.total
  );
  if (!matching.length) return null;

  const ids = matching.map((order: any) => order.id);
  const [{ data: itemRows, error: itemsError }, { data: paymentRows, error: paymentsError }] = await Promise.all([
    admin.from("order_items").select("order_id,product_id,quantity").in("order_id", ids),
    admin.from("payments").select("order_id,status").in("order_id", ids),
  ]);
  if (itemsError || paymentsError) return null;

  const wanted = itemSignature(items.map(item => ({ product_id: item.productId, quantity: item.quantity })));
  return matching.find((order: any) =>
    !(paymentRows || []).some((payment: any) =>
      payment.order_id === order.id && ["verified", "submitted"].includes(String(payment.status))
    ) &&
    itemSignature((itemRows || []).filter((item: any) => item.order_id === order.id)) === wanted
  ) || null;
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")!);
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")!);

  const userClient = createClient(
    supabaseUrl,
    publishableKeys.default,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const admin = createClient(
    supabaseUrl,
    secretKeys.default,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: runtimeConfigRow, error: runtimeConfigError } = await admin
    .from("internal_runtime_config")
    .select("value")
    .eq("key", "checkout")
    .single();

  if (runtimeConfigError || !runtimeConfigRow?.value) {
    return json({ error: "Checkout configuration unavailable" }, 503);
  }

  const runtimeConfig = runtimeConfigRow.value as {
    appsScriptUrl?: string;
    shippingRates?: Record<string, number>;
    foundingMemberFreeShippingSource?: string;
  };
  const SHIPPING_RATES = runtimeConfig.shippingRates || {};
  const FREE_SHIPPING_SOURCE = String(runtimeConfig.foundingMemberFreeShippingSource || "").trim();

  const invoiceBridge = invoiceBridgeFromEnv(runtimeConfig.appsScriptUrl);
  if (!invoiceBridge) {
    console.error("create-checkout-order: invoice bridge URL, host allowlist or INVOICE_BRIDGE_SECRET is not configured");
    return json({ error: "Checkout configuration unavailable" }, 503);
  }

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Invalid session" }, 401);
  if (!user.email_confirmed_at) return json({ error: "Verified email required" }, 403);

  let body: {
    items?: Array<{ productId?: string; quantity?: number }>;
    policyAcknowledged?: boolean;
    contactMethod?: string | null;
    customerNotes?: string | null;
    paymentMethod?: string | null;
    discountCode?: string | null;
  };

  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  if (body.policyAcknowledged !== true) {
    return json({ error: "Policy acknowledgment is required" }, 400);
  }

  const requestedPaymentMethod = String(body.paymentMethod || "").trim().toLowerCase();
  const paymentMethod =
    requestedPaymentMethod === "paypal" ? "PayPal" :
    requestedPaymentMethod === "venmo" ? "Venmo" :
    requestedPaymentMethod === "apple pay" || requestedPaymentMethod === "applepay" ? "Apple Pay" :
    requestedPaymentMethod === "zelle" ? "Zelle" :
    null;

  if (!paymentMethod) {
    return json({ error: "Choose PayPal, Venmo, Apple Pay, or Zelle before starting checkout" }, 400);
  }

  const requestedItems = Array.isArray(body.items) ? body.items : [];
  if (!requestedItems.length) return json({ error: "Your cart is empty" }, 400);
  if (requestedItems.length > MAX_CART_LINES) {
    return json({ error: `Please limit an order to ${MAX_CART_LINES} different products` }, 400);
  }

  const quantityById = new Map<string, number>();
  for (const item of requestedItems) {
    const id = String(item.productId || "").trim();
    const quantity = Number(item.quantity);
    if (!id || !Number.isInteger(quantity)) {
      return json({ error: "Invalid cart item" }, 400);
    }
    quantityById.set(id, (quantityById.get(id) || 0) + quantity);
  }
  for (const quantity of quantityById.values()) {
    if (quantity < 1 || quantity > MAX_LINE_QUANTITY) {
      return json({ error: `Each product quantity must be between 1 and ${MAX_LINE_QUANTITY}` }, 400);
    }
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,customer_number,first_name,last_name,email,phone,account_status,memberships(name)")
    .eq("auth_user_id", user.id)
    .single();

  if (profileError || !profile) return json({ error: "Customer profile not found" }, 404);
  if (String(profile.account_status || "").toLowerCase() !== "active") {
    return json({ error: "This customer account is not active" }, 403);
  }

  const productIds = [...quantityById.keys()];
  const { data: products, error: productError } = await admin
    .from("products")
    .select("id,name,product_code,price,active,storefront_status,shipping_from")
    .in("id", productIds);

  if (productError) return json({ error: "Catalog validation failed" }, 500);
  if (!products || products.length !== productIds.length) {
    return json({ error: "One or more products are no longer available" }, 409);
  }

  const validatedItems = [];
  for (const product of products) {
    if (!product.active || String(product.storefront_status || "").toLowerCase() !== "available") {
      return json({ error: `${product.name} is no longer available` }, 409);
    }

    const quantity = quantityById.get(product.id)!;
    const unitPrice = Number(product.price || 0);
    validatedItems.push({
      productId: product.id,
      productCode: product.product_code,
      productName: product.name,
      quantity,
      unitPrice,
      lineTotal: roundMoney(unitPrice * quantity),
      shippingFrom: product.shipping_from || "",
    });
  }

  const membershipName = String(profile.memberships?.name || "");
  const pricing: PricingInput = {
    lines: validatedItems,
    shippingRates: SHIPPING_RATES,
    foundingMember: membershipName.trim().toLowerCase() === "founding member",
    foundingMemberFreeShippingSource: FREE_SHIPPING_SOURCE,
    paymentMethod,
  };

  // Never trust a client-side discount amount: re-validate the code against
  // this order's server-side subtotal and shipping, then price it here.
  const requestedDiscountCode = String(body.discountCode || "").trim();
  let appliedDiscount: (PricingDiscount & { code: string }) | null = null;
  if (requestedDiscountCode) {
    const base = calculateTotals({ ...pricing, discount: null });
    const validation = await validateDiscountCode(
      supabaseUrl,
      publishableKeys.default,
      authHeader,
      requestedDiscountCode,
      base.subtotal,
      base.shipping,
    );
    if ("error" in validation) return json({ error: validation.error }, validation.status);
    appliedDiscount = validation.discount;
  }

  const totals = calculateTotals({ ...pricing, discount: appliedDiscount });
  const { subtotal, discount, shippingDiscount, shipping, processingFee, tax, total } = totals;
  const discountCode = appliedDiscount?.code || null;
  const now = new Date().toISOString();
  const requestToken = crypto.randomUUID();
  const customerName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();

  // A retry after a network error or a reload resumes the matching unpaid
  // checkout instead of creating a duplicate order (and Zelle invoice).
  const reusable = await findReusableOrder(admin, profile.id, paymentMethod, discountCode, totals, validatedItems);
  if (reusable) {
    const invoice = paymentMethod === "Zelle"
      ? (await admin.from("invoices").select("invoice_number,pdf_url").eq("order_id", reusable.id).maybeSingle()).data
      : null;

    if (paymentMethod !== "Zelle" || invoice?.pdf_url) {
      await admin.from("orders").update({
        customer_notes: body.customerNotes?.trim() || null,
        contact_method: body.contactMethod?.trim() || null,
        updated_at: now,
      }).eq("id", reusable.id);

      return json({
        success: true,
        reused: true,
        orderId: reusable.id,
        orderNumber: invoice?.invoice_number || reusable.order_number || "",
        invoicePdfReady: Boolean(invoice?.pdf_url),
        ...(invoice?.pdf_url ? { pdfUrl: invoice.pdf_url } : {}),
        discountCode,
        totals,
      });
    }
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      customer_id: profile.id,
      status: "checkout_pending",
      subtotal,
      discount_total: discount,
      discount_code: discountCode,
      shipping_discount_total: shippingDiscount,
      shipping_total: shipping,
      tax_total: tax,
      processing_fee_total: processingFee,
      total,
      payment_method: paymentMethod,
      payment_status: "pending",
      customer_notes: body.customerNotes?.trim() || null,
      contact_method: body.contactMethod?.trim() || null,
      submitted_at: now,
      admin_notes: "Nexus Pay Now checkout",
    })
.select("id,created_at")
    .single();

  if (orderError || !order) return json({ error: "Could not create checkout order" }, 500);

  const orderItems = validatedItems.map(item => ({
    order_id: order.id,
    product_id: item.productId,
    product_code: item.productCode,
    product_name: item.productName,
    quantity: item.quantity,
    unit_price: item.unitPrice,
    line_total: item.lineTotal,
  }));

  const { error: itemsError } = await admin.from("order_items").insert(orderItems);
  if (itemsError) {
    await admin.from("orders").update({
      status: "checkout_error",
      admin_notes: "Nexus Pay Now checkout: order item insert failed",
    }).eq("id", order.id);
    return json({ error: "Could not save checkout items" }, 500);
  }

  // PayPal/Venmo/Apple Pay fast path: return as soon as the secure Science By Hugs
  // order and line items exist. Branded invoice/PDF generation is finalized
  // after the provider confirms payment in paypal-capture-order.
  if (isWalletPayment(paymentMethod)) {
    return json({
      success: true,
      orderId: order.id,
      orderNumber: "",
      invoicePdfReady: false,
      discountCode,
      totals,
    });
  }

  const bridgePayload = {
    requestToken,
    orderId: order.id,
    paymentMethod,
    paymentStatus: "Pending Payment",
    customer: {
      customerId: profile.customer_number || "",
      firstName: profile.first_name || "",
      lastName: profile.last_name || "",
      name: customerName,
      email: profile.email || user.email || "",
      phone: profile.phone || "",
      membership: membershipName,
      accountStatus: profile.account_status || "Active",
      contactMethod: body.contactMethod?.trim() || "",
    },
    items: validatedItems,
    discountCode,
    totals: { subtotal, discount, shipping, processingFee, tax, total },
    notes: body.customerNotes?.trim() || "",
  };

  let sheetResponse: Response;
  let sheetData: {
    success?: boolean;
    invoiceNumber?: string;
    invoiceSheet?: string;
    invoiceSheetUrl?: string;
    error?: string;
  } | null;

  try {
    ({ response: sheetResponse, data: sheetData } =
      await postToInvoiceBridge(invoiceBridge, "nexusInvoiceRequest", bridgePayload));
  } catch {
    await admin.from("orders").update({
      status: "checkout_sync_error",
      admin_notes: "Nexus Pay Now checkout: branded invoice bridge unavailable",
    }).eq("id", order.id);
    return json({ error: "Could not create the branded invoice" }, 503);
  }

  if (!sheetResponse.ok || !sheetData?.success || !sheetData.invoiceNumber || !sheetData.invoiceSheet) {
    await admin.from("orders").update({
      status: "checkout_sync_error",
      admin_notes: `Nexus Pay Now checkout: ${sheetData?.error || "branded invoice bridge rejected request"}`,
    }).eq("id", order.id);
    return json({ error: sheetData?.error || "Could not create the branded invoice" }, 502);
  }

  const pdfPayload = {
    invoiceNumber: sheetData.invoiceNumber,
    invoiceSheet: sheetData.invoiceSheet,
  };

  let pdfResponse: Response;
  let pdfData: {
    success?: boolean;
    pdfFileId?: string;
    pdfUrl?: string;
    pdfName?: string;
    error?: string;
  } | null;

  try {
    ({ response: pdfResponse, data: pdfData } =
      await postToInvoiceBridge(invoiceBridge, "approveNexusInvoice", pdfPayload));
  } catch {
    await admin.from("orders").update({
      order_number: sheetData.invoiceNumber,
      status: "checkout_sync_error",
      admin_notes: "Nexus Pay Now checkout: branded PDF bridge unavailable",
    }).eq("id", order.id);
    return json({
      error: "Branded invoice was created, but its PDF could not be generated",
      invoiceNumber: sheetData.invoiceNumber,
    }, 503);
  }

  if (!pdfResponse.ok || !pdfData?.success || !pdfData.pdfUrl) {
    await admin.from("orders").update({
      order_number: sheetData.invoiceNumber,
      status: "checkout_sync_error",
      admin_notes: `Nexus Pay Now checkout: ${pdfData?.error || "branded PDF bridge failed"}`,
    }).eq("id", order.id);
    return json({
      error: pdfData?.error || "Branded invoice was created, but its PDF could not be generated",
      invoiceNumber: sheetData.invoiceNumber,
    }, 502);
  }

  const { data: record, error: recordError } = await admin
    .from("invoices")
    .insert({
      invoice_number: sheetData.invoiceNumber,
      order_id: order.id,
      customer_id: profile.id,
      status: "direct_checkout",
      subtotal,
      shipping_total: shipping,
      discount_total: discount,
      tax_total: tax,
      processing_fee_total: processingFee,
      total,
      payment_method: paymentMethod,
      google_sheet_name: sheetData.invoiceSheet,
      google_sheet_url: sheetData.invoiceSheetUrl || null,
      pdf_status: "created",
      pdf_url: pdfData.pdfUrl,
      pdf_created_at: now,
      send_status: "not_sent",
      contact_method: body.contactMethod?.trim() || null,
      customer_name_snapshot: customerName,
      customer_email_snapshot: profile.email || user.email || "",
      customer_phone_snapshot: profile.phone || "",
    })
.select("id,invoice_number")
    .single();

  if (recordError || !record) {
    await admin.from("orders").update({
      status: "checkout_sync_error",
      admin_notes: "Nexus Pay Now checkout created, but Core operation record failed",
    }).eq("id", order.id);
    return json({ error: "Checkout order created but Core synchronization needs review" }, 500);
  }

  await admin.from("orders").update({
    order_number: sheetData.invoiceNumber,
    status: "checkout_pending",
    admin_notes: `Nexus Pay Now checkout ${requestToken}: branded invoice PDF ready`,
  }).eq("id", order.id);

  await admin.from("invoice_events").insert({
    invoice_id: record.id,
    event_type: "direct_checkout_created",
    description: "Customer started Pay Now checkout and branded invoice PDF was created automatically.",
    metadata: {
      source: "nexus_pay_now",
      requestToken,
      autoApproved: true,
      pdfFileId: pdfData.pdfFileId || null,
      pdfUrl: pdfData.pdfUrl,
    },
  });

  return json({
    success: true,
    orderId: order.id,
    orderNumber: sheetData.invoiceNumber,
    invoicePdfReady: true,
    pdfUrl: pdfData.pdfUrl,
    discountCode,
    totals,
  });
}

Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (error) {
    // Keep CORS headers on unexpected failures so the browser sees this error.
    console.error("create-checkout-order failed", error instanceof Error ? error.message : error);
    return json({ error: "Checkout could not be started. Please try again." }, 500);
  }
});
