const test = require('node:test'), assert = require('node:assert/strict'), { createHmac } = require('node:crypto')
const { loadShared } = require('./helpers/load-ts.cjs')
const shared = loadShared()
const rates = { 'Shipping Gigi': 20, 'Shipping - Amazon': 3 }
const lines = [{ unitPrice: 100, quantity: 2, shippingFrom: 'Shipping Gigi' }, { unitPrice: 30, quantity: 1, shippingFrom: 'Shipping - Amazon' }]
const totals = input => ({ ...shared.calculateTotals({ lines, shippingRates: rates, foundingMember: false, foundingMemberFreeShippingSource: 'Shipping Gigi', ...input }) })

test('founding member free shipping follows the configured source, case-insensitively', () => {
  assert.equal(totals({}).shipping, 23)
  assert.equal(totals({ foundingMember: true }).shipping, 3)
  assert.equal(totals({ foundingMember: true, foundingMemberFreeShippingSource: 'shipping gigi' }).shipping, 3)
  assert.equal(totals({ foundingMember: true, foundingMemberFreeShippingSource: '' }).shipping, 23)
})

test('percent discounts reduce taxable merchandise and free-shipping discounts are capped at shipping', () => {
  const percent = totals({ discount: { kind: 'group_buy', discountPercent: 10 } })
  assert.deepEqual([percent.subtotal, percent.discount, percent.shipping, percent.tax, percent.total], [230, 23, 23, 16.56, 246.56])
  const freeShipping = totals({ discount: { kind: 'free_shipping', shippingDiscount: 50 } })
  assert.deepEqual([freeShipping.discount, freeShipping.shippingDiscount, freeShipping.shipping, freeShipping.totalSavings], [0, 23, 0, 23])
  assert.equal(totals({ discount: { kind: 'new_customer', discountPercent: 250 } }).discount, 230)
})

test('wallet methods add the 5% fee before 8% tax; Zelle and previews do not', () => {
  for (const paymentMethod of ['PayPal', 'Venmo', 'Apple Pay']) {
    const wallet = totals({ paymentMethod })
    assert.deepEqual([wallet.processingFee, wallet.tax, wallet.total], [11.5, 19.32, 283.82])
  }
  for (const paymentMethod of ['Zelle', null]) assert.deepEqual([totals({ paymentMethod }).processingFee, totals({ paymentMethod }).total], [0, 271.4])
})

test('invoice bridge URLs must be HTTPS on an allowlisted host with a long secret', () => {
  const secret = 'x'.repeat(32), url = 'https://script.google.com/macros/s/abc/exec'
  assert.equal(shared.resolveInvoiceBridge(url, secret, undefined).url.hostname, 'script.google.com')
  for (const bad of ['http://script.google.com/exec', 'https://attacker.example/exec', 'https://script.google.com:8443/exec', 'https://user:pw@script.google.com/exec', 'not a url', ''])
    assert.equal(shared.resolveInvoiceBridge(bad, secret, undefined), null, bad)
  assert.equal(shared.resolveInvoiceBridge(url, 'short', undefined), null)
  assert.equal(shared.resolveInvoiceBridge('https://bridge.example.test/hook', secret, 'script.google.com, bridge.example.test').url.hostname, 'bridge.example.test')
})

test('signing helpers match standard HMAC-SHA256 and compare secrets by digest', async () => {
  assert.equal(await shared.hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'), createHmac('sha256', 'key').update('The quick brown fox jumps over the lazy dog').digest('hex'))
  assert.equal(await shared.safeEqual('cron-secret', 'cron-secret'), true)
  for (const other of ['cron-secreT', 'cron-secret ', '', 'c']) assert.equal(await shared.safeEqual(other, 'cron-secret'), false)
})
