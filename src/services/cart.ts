import type { CatalogProduct } from './catalog'
import {
  calculateTotals,
  MAX_LINE_QUANTITY,
  type CheckoutPaymentMethod,
  type PricingDiscount,
} from '../../supabase/functions/_shared/pricing.ts'

export { MAX_LINE_QUANTITY }

export type CartItem = {
  id: string
  product: string
  price: number
  quantity: number
  shippingFrom: string
}

export type CartTotals = {
  subtotal: number
  discount: number
  shippingDiscount: number
  totalSavings: number
  shipping: number
  processingFee: number
  tax: number
  total: number
}

const STORAGE_KEY = 'sbhNexusCart'

// Preview rates only. Checkout totals come from create-checkout-order, which
// reads the live rates from internal_runtime_config.
export const FOUNDING_MEMBER_FREE_SHIPPING_SOURCE = 'Shipping Gigi'
export const SHIPPING_RATES: Record<string, number> = {
  'Shipping - Emlin (L)': 70,
  'Shipping - Emlin (S)': 50,
  'Shipping - Emlin (US)': 20,
  'Shipping - Amazon': 3,
  'Shipping - Ella (US)': 20,
  'Shipping - Ella (CN)': 50,
  'Shipping Gigi': 20,
  'Shipping': 0,
}

export function loadCart(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCart(cart: CartItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
}

export function clearCart() {
  localStorage.removeItem(STORAGE_KEY)
}

export function addProduct(cart: CartItem[], product: CatalogProduct): CartItem[] {
  const next = cart.map(item => ({ ...item }))
  const existing = next.find(item => item.id === product.id)

  if (existing) {
    existing.quantity = Math.min(MAX_LINE_QUANTITY, existing.quantity + 1)
  } else {
    next.push({
      id: product.id,
      product: product.name,
      price: Number(product.price) || 0,
      quantity: 1,
      shippingFrom: product.shipping_from || '',
    })
  }

  saveCart(next)
  return next
}

export function changeQuantity(cart: CartItem[], id: string, delta: number): CartItem[] {
  const next = cart
    .map(item => item.id === id ? { ...item, quantity: Math.min(MAX_LINE_QUANTITY, item.quantity + delta) } : { ...item })
    .filter(item => item.quantity > 0)

  saveCart(next)
  return next
}

export type AppliedDiscount = PricingDiscount

// Uses the same pricing module as create-checkout-order. Without a payment
// method the preview excludes the wallet processing fee.
export function calculateCart(
  cart: CartItem[],
  foundingMember: boolean,
  appliedDiscount?: AppliedDiscount | null,
  paymentMethod?: CheckoutPaymentMethod | null,
): CartTotals {
  return calculateTotals({
    lines: cart.map(item => ({
      unitPrice: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      shippingFrom: item.shippingFrom,
    })),
    shippingRates: SHIPPING_RATES,
    foundingMember,
    foundingMemberFreeShippingSource: FOUNDING_MEMBER_FREE_SHIPPING_SOURCE,
    discount: appliedDiscount,
    paymentMethod,
  })
}

export function cartQuantity(cart: CartItem[]) {
  return cart.reduce((total, item) => total + item.quantity, 0)
}
