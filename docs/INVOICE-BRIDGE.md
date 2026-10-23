# Invoice bridge request signing

`create-checkout-order` (Zelle) and `paypal-capture-order` (after a wallet payment) call the Google Apps Script invoice bridge at `internal_runtime_config.checkout.appsScriptUrl`. Each request is signed with a dedicated shared secret. The secret is never sent.

## Contract

- Method `POST`, body JSON (non-ASCII characters are `\uXXXX`-escaped, so the body is plain ASCII).
- Query parameters:
  - `api`: `nexusInvoiceRequest` or `approveNexusInvoice`
  - `ts`: Unix time in seconds
  - `sig`: lowercase hex `HMAC-SHA256(INVOICE_BRIDGE_SECRET, ts + "." + api + "." + body)`
- Apps Script web apps cannot read request headers, so the signature travels in the query string. It is only valid for that exact body, API and timestamp.

The functions only send requests to HTTPS URLs whose host is in `INVOICE_BRIDGE_ALLOWED_HOSTS` (comma-separated Edge Function secret, default `script.google.com`). Editing the config row cannot redirect requests elsewhere.

## Apps Script verification

Store the same secret in **Project Settings → Script Properties** as `INVOICE_BRIDGE_SECRET`, then check every request before routing it:

```js
var BRIDGE_MAX_SKEW_SECONDS = 300;

function verifyBridgeRequest_(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('INVOICE_BRIDGE_SECRET');
  var api = e.parameter.api || '';
  var ts = e.parameter.ts || '';
  var sig = e.parameter.sig || '';
  var body = (e.postData && e.postData.contents) || '';
  if (!secret || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > BRIDGE_MAX_SKEW_SECONDS) return false;
  var bytes = Utilities.computeHmacSha256Signature(ts + '.' + api + '.' + body, secret, Utilities.Charset.UTF_8);
  var expected = bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  var difference = 0;
  for (var i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return difference === 0;
}

function doPost(e) {
  if (!verifyBridgeRequest_(e)) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var payload = JSON.parse(e.postData.contents);
  // ...existing routing on e.parameter.api...
}
```

Optionally also reject a `requestToken` the script has already processed, so a captured request cannot be replayed within the five-minute window. Avoid logging request bodies; they contain customer contact details.

## Rollout

1. Generate a secret (`openssl rand -hex 32`). Set it as an Edge Function secret (`supabase secrets set INVOICE_BRIDGE_SECRET=…`) and as the Script Property above. Set `INVOICE_BRIDGE_ALLOWED_HOSTS` only if the bridge is not on `script.google.com`.
2. Deploy the Apps Script with signature verification. Until step 3 is live it may also accept the previous `bridgeKey` body field.
3. Deploy `create-checkout-order` and `paypal-capture-order`. Without the secret, or with a disallowed host, checkout returns 503 and post-payment invoices are flagged for review.
4. Remove the `bridgeKey` check from the script.
