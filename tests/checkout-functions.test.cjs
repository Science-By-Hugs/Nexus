const test = require('node:test'), assert = require('node:assert/strict'), { createHmac } = require('node:crypto')
const { loadEdgeFunction, SECRET_KEY, BRIDGE_SECRET, SUPABASE_URL } = require('./helpers/edge-function.cjs')

const user = { id: 'user-1', email: 'ada@example.test', email_confirmed_at: '2026-10-01T00:00:00Z' }
const bridgeUrl = 'https://script.google.com/macros/s/test/exec'
const baseTables = () => ({
  internal_runtime_config: [{ key: 'checkout', value: { appsScriptUrl: bridgeUrl, shippingRates: { 'Shipping Gigi': 20, 'Shipping - Amazon': 3 }, foundingMemberFreeShippingSource: 'Shipping Gigi' } }],
  memberships: [{ id: 'm-member', name: 'Member' }, { id: 'm-founding', name: 'Founding Member' }, { id: 'm-principal', name: 'Principal Scientist' }],
  profiles: [{ id: 'profile-1', auth_user_id: 'user-1', customer_number: 'SBH-0001', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.test', phone: '', account_status: 'Active', membership_id: 'm-member' }],
  products: [
    { id: 'p1', name: 'Vial A', product_code: 'A', price: 100, active: true, storefront_status: 'Available', shipping_from: 'Shipping Gigi' },
    { id: 'p2', name: 'Vial B', product_code: 'B', price: 30, active: true, storefront_status: 'Available', shipping_from: 'Shipping - Amazon' },
  ],
})
const discountRoute = discount => [/\/functions\/v1\/discount-code$/, () => ({ body: { success: true, discount } })]
const bridgeRoute = [/^https:\/\/script\.google\.com\//, url => ({
  body: url.searchParams.get('api') === 'nexusInvoiceRequest'
    ? { success: true, invoiceNumber: 'INV-1001', invoiceSheet: 'INV-1001', invoiceSheetUrl: 'https://sheets.test/1' }
    : { success: true, pdfUrl: 'https://drive.test/INV-1001.pdf', pdfFileId: 'file-1' },
})]
const checkout = (body = {}) => ({ items: [{ productId: 'p1', quantity: 2 }], policyAcknowledged: true, paymentMethod: 'PayPal', ...body })

function assertSignedBridgeCalls(fetchCalls, apis) {
  const calls = fetchCalls.filter(call => call.url.startsWith(bridgeUrl))
  assert.deepEqual(calls.map(call => new URL(call.url).searchParams.get('api')), apis)
  for (const call of calls) {
    const url = new URL(call.url), ts = url.searchParams.get('ts')
    assert.ok(Math.abs(Date.now() / 1000 - Number(ts)) < 60)
    assert.equal(url.searchParams.get('sig'), createHmac('sha256', BRIDGE_SECRET).update(`${ts}.${url.searchParams.get('api')}.${call.init.body}`).digest('hex'))
    assert.equal(call.init.body.includes(SECRET_KEY) || call.url.includes(SECRET_KEY) || 'bridgeKey' in call.body, false)
  }
}

test('create-checkout-order re-validates the code with server amounts and stores the discount', async () => {
  const fn = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user, routes: [discountRoute({ valid: true, code: 'SAVE10', kind: 'group_buy', discountPercent: 10 })] })
  const response = await fn.call(checkout({ discountCode: 'save10', discount: 500, totals: { total: 1 } }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.discountCode, 'SAVE10')
  assert.deepEqual(result.totals, { subtotal: 200, discount: 20, shippingDiscount: 0, totalSavings: 20, shipping: 20, processingFee: 9, tax: 15.12, total: 224.12 })
  const [validation] = fn.fetchCalls
  assert.equal(validation.url, SUPABASE_URL + '/functions/v1/discount-code')
  assert.deepEqual(validation.body, { code: 'save10', subtotal: 200, shipping: 20 })
  assert.equal(validation.init.headers.Authorization, 'Bearer user-token')
  const [order] = fn.db.orders
  assert.deepEqual([order.discount_code, order.discount_total, order.shipping_discount_total, order.total], ['SAVE10', 20, 0, 224.12])
})

test('free-shipping codes reduce shipping, and rejected codes create no order', async () => {
  const free = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user, routes: [discountRoute({ valid: true, code: 'SHIPFREE', kind: 'free_shipping', shippingDiscount: 20 })] })
  const totals = (await (await free.call(checkout({ discountCode: 'SHIPFREE', paymentMethod: 'Venmo' }))).json()).totals
  assert.deepEqual([totals.shipping, totals.shippingDiscount, totals.totalSavings, totals.total], [0, 20, 20, 226.8])
  assert.equal(free.db.orders[0].shipping_discount_total, 20)

  const rejected = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user, routes: [discountRoute({ valid: false, error: 'This code has expired.' })] })
  const response = await rejected.call(checkout({ discountCode: 'OLD' }))
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'This code has expired.')
  assert.equal(rejected.db.orders, undefined)
})

test('a retried checkout resumes the matching unpaid order instead of creating another', async () => {
  const fn = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user })
  const first = await (await fn.call(checkout())).json()
  const retry = await (await fn.call(checkout({ customerNotes: 'Leave at desk' }))).json()
  assert.equal(retry.reused, true)
  assert.equal(retry.orderId, first.orderId)
  assert.equal(fn.db.orders.length, 1)
  assert.equal(fn.db.orders[0].customer_notes, 'Leave at desk')
  const changed = await (await fn.call(checkout({ items: [{ productId: 'p1', quantity: 3 }] }))).json()
  assert.notEqual(changed.orderId, first.orderId)
  fn.db.payments = [{ order_id: changed.orderId, status: 'verified' }]
  const afterPaid = await (await fn.call(checkout({ items: [{ productId: 'p1', quantity: 3 }] }))).json()
  assert.notEqual(afterPaid.orderId, changed.orderId)
})

test('the Apple Pay sheet preview and the server order total come from the same pricing', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
  const pricing = require('./helpers/load-ts.cjs').loadShared(), context = { exports: {}, require: () => pricing }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/cart.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const cart = context.exports
  const tables = baseTables()
  tables.internal_runtime_config[0].value.shippingRates = cart.SHIPPING_RATES
  tables.products[0].price = 33.35
  const discount = { valid: true, code: 'GROUP15', kind: 'group_buy', discountPercent: 15 }
  const fn = loadEdgeFunction('create-checkout-order', { tables, user, routes: [discountRoute(discount)] })
  const server = (await (await fn.call(checkout({ paymentMethod: 'Apple Pay', items: [{ productId: 'p1', quantity: 3 }, { productId: 'p2', quantity: 1 }], discountCode: 'GROUP15' }))).json()).totals
  const preview = cart.calculateCart([{ id: 'p1', price: 33.35, quantity: 3, shippingFrom: 'Shipping Gigi' }, { id: 'p2', price: 30, quantity: 1, shippingFrom: 'Shipping - Amazon' }], false, discount, 'Apple Pay')
  assert.deepEqual({ ...preview }, server)
})

test('quantities above the limit get a specific error, including duplicate lines', async () => {
  const fn = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user })
  for (const items of [[{ productId: 'p1', quantity: 100 }], [{ productId: 'p1', quantity: 60 }, { productId: 'p1', quantity: 40 }]]) {
    const response = await fn.call(checkout({ items }))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error, 'Each product quantity must be between 1 and 99')
  }
})

test('Zelle checkout signs both invoice bridge calls and never sends a project key', async () => {
  const fn = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user, routes: [bridgeRoute] })
  const response = await fn.call(checkout({ paymentMethod: 'Zelle', items: [{ productId: 'p2', quantity: 1 }], customer: 'Zoë' }))
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  assert.equal(result.invoicePdfReady, true)
  assertSignedBridgeCalls(fn.fetchCalls, ['nexusInvoiceRequest', 'approveNexusInvoice'])
})

test('checkout refuses to contact an unapproved bridge host or run without a bridge secret', async () => {
  const tables = baseTables()
  tables.internal_runtime_config[0].value.appsScriptUrl = 'https://attacker.example/exec'
  for (const options of [{ tables }, { tables: baseTables(), env: { INVOICE_BRIDGE_SECRET: '' } }]) {
    const fn = loadEdgeFunction('create-checkout-order', { ...options, user, routes: [[/./, () => ({ body: {} })]] })
    const response = await fn.call(checkout({ paymentMethod: 'Zelle' }))
    assert.equal(response.status, 503)
    assert.equal(fn.fetchCalls.length, 0)
    assert.equal(fn.db.orders, undefined)
  }
})

test('unexpected failures still return CORS headers', async () => {
  const fn = loadEdgeFunction('create-checkout-order', { tables: baseTables(), user, env: { SUPABASE_PUBLISHABLE_KEYS: 'not json' } })
  const response = await fn.call(checkout())
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://nexus.sciencebyhugs.com')
})

// paypal-capture-order

const paypalToken = [/\/v1\/oauth2\/token$/, () => ({ body: { access_token: 'paypal-token' } })]
const captureRoute = (value, status = 'COMPLETED') => [/\/v2\/checkout\/orders\/PP-1\/capture$/, () => ({
  body: { status, purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status, amount: { value, currency_code: 'USD' } }] } }] },
})]
const captureTables = (extra = {}) => ({
  ...baseTables(),
  orders: [{ id: 'order-1', customer_id: 'profile-1', order_number: null, subtotal: 200, discount_total: 20, discount_code: 'SAVE10', shipping_total: 20, processing_fee_total: 9, tax_total: 15.12, total: 224.12, payment_status: 'paypal_pending', status: 'checkout_pending' }],
  order_items: [{ order_id: 'order-1', product_id: 'p1', product_code: 'A', product_name: 'Vial A', quantity: 2, unit_price: 100, line_total: 200 }],
  payments: [{ id: 'pay-1', order_id: 'order-1', provider: 'PayPal', provider_order_id: 'PP-1', status: 'paypal_created' }],
  ...extra,
})
const capture = { orderId: 'order-1', paypalOrderId: 'PP-1', paymentMethod: 'PayPal' }

test('capture rejects an amount that differs from the order total and leaves the order unpaid', async () => {
  const fn = loadEdgeFunction('paypal-capture-order', { tables: captureTables(), user, routes: [paypalToken, captureRoute('200.00')] })
  const response = await fn.call(capture)
  assert.equal(response.status, 409)
  assert.equal(fn.db.orders[0].payment_status, 'paypal_pending')
  assert.equal(fn.db.payments[0].status, 'paypal_created')
})

test('capture marks the order paid and signs the post-payment invoice bridge calls', async () => {
  const fn = loadEdgeFunction('paypal-capture-order', { tables: captureTables(), user, routes: [paypalToken, captureRoute('224.12'), bridgeRoute] })
  const result = await (await fn.call(capture)).json()
  assert.deepEqual([result.success, result.invoicePdfReady, result.orderSyncError], [true, true, null])
  assert.deepEqual([fn.db.orders[0].payment_status, fn.db.orders[0].status, fn.db.payments[0].status], ['paid', 'processing', 'verified'])
  assertSignedBridgeCalls(fn.fetchCalls, ['nexusInvoiceRequest', 'approveNexusInvoice'])
  assert.equal(fn.fetchCalls.find(call => call.url.includes('nexusInvoiceRequest')).body.discountCode, 'SAVE10')
})

test('a failed "mark paid" update is retried, recorded on the payment and reported', async () => {
  const failures = { 'orders.update': entry => entry.values.payment_status === 'paid' ? { message: 'connection reset' } : null }
  const fn = loadEdgeFunction('paypal-capture-order', { tables: captureTables(), failures, user, routes: [paypalToken, captureRoute('224.12'), bridgeRoute] })
  const result = await (await fn.call(capture)).json()
  assert.equal(result.success, true)
  assert.ok(result.orderSyncError)
  assert.equal(fn.log.filter(entry => entry.table === 'orders' && entry.action === 'update' && entry.values.payment_status === 'paid').length, 2)
  assert.match(fn.db.payments[0].notes, /CAP-1.*could not be marked paid: connection reset/)
})

test('non-JSON PayPal replies and PayPal auth failures return errors with CORS headers', async () => {
  for (const routes of [[paypalToken, [/capture$/, () => ({ status: 502, body: '<html>Bad gateway</html>' })]], [[/oauth2/, () => ({ status: 500, body: '<html>' })]]]) {
    const fn = loadEdgeFunction('paypal-capture-order', { tables: captureTables(), user, routes })
    const response = await fn.call(capture)
    assert.ok(response.status >= 500)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://nexus.sciencebyhugs.com')
    assert.equal(fn.db.orders[0].payment_status, 'paypal_pending')
  }
})

// Referral upgrade, exercised through a successful capture by profile-1.
function referralTables(qualifiedBefore, referrerMembership) {
  const referrals = Array.from({ length: qualifiedBefore }, (_, index) => ({ id: 'r' + index, referrer_id: 'referrer', referred_customer_id: 'other-' + index, qualified_at: '2026-09-01T00:00:00.000Z' }))
  referrals.push({ id: 'r-new', referrer_id: 'referrer', referred_customer_id: 'profile-1', qualified_at: null })
  const tables = captureTables({ referrals })
  tables.profiles.push({ id: 'referrer', auth_user_id: 'user-2', membership_id: referrerMembership })
  return tables
}
async function referrerTierAfterCapture(qualifiedBefore, referrerMembership) {
  const fn = loadEdgeFunction('paypal-capture-order', { tables: referralTables(qualifiedBefore, referrerMembership), user, routes: [paypalToken, captureRoute('224.12'), bridgeRoute] })
  assert.equal((await fn.call(capture)).status, 200)
  assert.ok(fn.db.referrals.find(referral => referral.id === 'r-new').qualified_at)
  return fn.db.profiles.find(profile => profile.id === 'referrer').membership_id
}

test('the 20th qualified referral upgrades the referrer once and never replaces Founding Member', async () => {
  assert.equal(await referrerTierAfterCapture(19, 'm-member'), 'm-principal')
  assert.equal(await referrerTierAfterCapture(19, 'm-founding'), 'm-founding')
  assert.equal(await referrerTierAfterCapture(20, 'm-member'), 'm-member')
  assert.equal(await referrerTierAfterCapture(18, 'm-member'), 'm-member')
})

// Provider switching on a shared payments row.

const zelleTables = payment => ({
  ...baseTables(),
  orders: [{ id: 'order-1', customer_id: 'profile-1', total: 100, status: 'checkout_pending', payment_status: 'paypal_pending' }],
  invoices: [{ id: 'inv-1', order_id: 'order-1', invoice_number: 'INV-1', status: 'direct_checkout', send_status: 'not_sent' }],
  payments: [{ id: 'pay-1', order_id: 'order-1', provider_order_id: 'PP-1', ...payment }],
})
const paypalOrderStatus = status => [/\/v2\/checkout\/orders\/PP-1$/, () => ({ body: { id: 'PP-1', status } })]

test('Zelle cannot replace a PayPal order the payer already approved', async () => {
  const blocked = loadEdgeFunction('zelle-submit-payment', { tables: zelleTables({ provider: 'PayPal', status: 'paypal_created' }), user, routes: [paypalToken, paypalOrderStatus('APPROVED')] })
  assert.equal((await blocked.call({ orderId: 'order-1' })).status, 409)
  assert.equal(blocked.db.payments[0].provider, 'PayPal')

  const allowed = loadEdgeFunction('zelle-submit-payment', { tables: zelleTables({ provider: 'Venmo', status: 'venmo_created' }), user, routes: [paypalToken, paypalOrderStatus('CREATED')] })
  assert.equal((await allowed.call({ orderId: 'order-1' })).status, 200)
  assert.deepEqual([allowed.db.payments[0].provider, allowed.db.payments[0].status], ['Zelle', 'submitted'])
})

test('PayPal checkout cannot replace a reported Zelle payment, a verified payment, or an approved wallet order', async () => {
  for (const [payment, routes] of [
    [{ provider: 'Zelle', status: 'submitted', provider_order_id: null }, []],
    [{ provider: 'PayPal', status: 'verified' }, []],
    [{ provider: 'Venmo', status: 'venmo_created' }, [paypalToken, paypalOrderStatus('APPROVED')]],
  ]) {
    const fn = loadEdgeFunction('paypal-create-order', { tables: zelleTables(payment), user, routes })
    assert.equal((await fn.call({ orderId: 'order-1', paymentMethod: 'PayPal' })).status, 409)
    assert.equal(fn.db.payments[0].status, payment.status)
    assert.equal(fn.fetchCalls.some(call => call.url.endsWith('/v2/checkout/orders')), false)
  }
})
