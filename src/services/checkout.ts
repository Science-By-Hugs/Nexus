import { assertTestPaymentsEnabled } from '../config'
import { supabase } from './supabase'
import type { CartItem } from './cart'

export type CheckoutOrderResult = {
  success: boolean
  orderId: string
  orderNumber: string
  discountCode?: string | null
  totals: {
    subtotal: number
    discount: number
    shippingDiscount?: number
    totalSavings?: number
    shipping: number
    processingFee: number
    tax: number
    total: number
  }
}

export async function createCheckoutOrder(
  cart: CartItem[],
  options: {
    policyAcknowledged: boolean
    contactMethod?: string
    customerNotes?: string
    discountCode?: string
    paymentMethod: 'PayPal' | 'Venmo' | 'Apple Pay' | 'Zelle'
  },
): Promise<CheckoutOrderResult> {
  assertTestPaymentsEnabled()
  const { data, error } = await supabase.functions.invoke('create-checkout-order', {
    method: 'POST',
    body: {
      items: cart.map(item => ({
        productId: item.id,
        quantity: item.quantity,
      })),
      policyAcknowledged: options.policyAcknowledged,
      contactMethod: options.contactMethod || null,
      customerNotes: options.customerNotes || null,
      discountCode: options.discountCode || null,
      paymentMethod: options.paymentMethod,
    },
  })

  if (error) {
    throw new Error(
      typeof data?.error === 'string'
        ? data.error
        : error.message || 'Could not start checkout.',
    )
  }

  if (!data?.success || !data?.orderId) {
    throw new Error(data?.error || 'Could not start checkout.')
  }

  return data as CheckoutOrderResult
}

export type SandboxOrder = { id: string; order_number: string; total: number; sandbox: true }
export async function submitSandboxOrder(cart: CartItem[], options: { city: string; idempotencyKey: string }): Promise<SandboxOrder> {
  if (!cart.length) throw new Error('Your cart is empty.')
  const { data, error } = await supabase.rpc('staging_submit_order', {
    p_items: cart.map(item => ({ product_id: item.id, quantity: item.quantity, unit_price: item.price })),
    p_idempotency_key: options.idempotencyKey,
    p_city: options.city,
  })
  if (error) throw new Error(error.message || 'Could not reserve this sandbox order.')
  if (!data?.id || data.sandbox !== true) throw new Error('Unexpected sandbox order response.')
  return data as SandboxOrder
}

export async function cancelSandboxOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('staging_cancel_order', { p_order_id: orderId })
  if (error) throw new Error(error.message || 'Could not cancel this sandbox reservation.')
}
