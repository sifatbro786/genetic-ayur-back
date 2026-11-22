# Genetic Ayur API

Backend for the Genetic Ayur landing-page store (`genetic-ayur-front`, Next.js).
Express 5 + MongoDB/Mongoose. It follows the STR Solutions Footpath base
(security middleware, server-side pricing, variant identity, guest order tokens)
but leaves out what a small landing-page store does not need (categories, cart,
coupons, campaigns, shopper accounts).

## Run it

```bash
npm install
cp .env.example .env        # then fill MONGODB_URI, JWT_SECRET, CLIENT_URL
npm run seed                # site settings, landing page, Kasturi Active Power
npm run admin:create -- owner@example.com "a long password" "Owner"
npm run dev                 # http://localhost:5000
npm test                    # unit + HTTP tests; DB tests use an in-memory MongoDB
```

Node 20.6 or newer.

## API: storefront and checkout (Phase 1)

Every response is `{ success: true, ... }` or `{ success: false, message, code?, errors? }`.

| Method | Path | Body | 200 response |
|---|---|---|---|
| GET | `/health` | | `{ success, status }` (503 when the DB is down) |
| GET | `/api/storefront` | | `{ success, site, landing, products }` |
| GET | `/api/site` | | `{ success, site }` |
| GET | `/api/landing` | | `{ success, landing }` (hidden sections removed) |
| GET | `/api/products` | | `{ success, products }` (active only, by `sortOrder`) |
| GET | `/api/products/:slug` | | `{ success, product }` |
| POST | `/api/checkout/calculate` | `{ items: [{ slug, options, quantity }], zone, paymentMethod? }` | `{ success, totals }` |
| POST | `/api/admin/auth/login` | `{ email, password }` | `{ success, token, user }` |
| GET | `/api/admin/auth/me` | Bearer token | `{ success, user }` |
| PATCH | `/api/admin/auth/password` | `{ currentPassword, newPassword }` | `{ success, token }` |

`zone` is one of `dhaka_inside`, `dhaka_sub`, `outside_dhaka` (only enabled ones
are accepted). `paymentMethod` is `COD`, `bKash`, `Nagad` or `Online` (SSLCommerz);
`advanceMethod` picks the prepaid method for a COD delivery advance.

Public product shape: no raw `stock`. Each variant has `maxQuantity` (0 to 10)
and `inStock`, and the product has `inStock`.

`totals`:

```js
{
  items: [{ slug, name, nameBn, image, options, note, unitPrice, comparePrice,
            quantity, units, freeShipping, lineTotal }],
  itemsPrice, shippingPrice, totalPrice, savings, freeShippingApplied,
  zone: { key, label, charge },
  paymentMethod, availablePaymentMethods,
  payNowVia,       // { method, flow: "manual"|"gateway", provider? } or null
  advanceMethods,  // COD with a delivery advance: methods that can collect it
  payNow,          // paid before the order is processed
  payOnDelivery,   // cash to the courier
  requiresTrxId,   // manual bKash/Nagad: form must ask TrxID + sender number
  redirectsToGateway // bKash gateway / SSLCommerz: browser goes to the gateway
}
```

Business errors from calculate carry a `code`: `EMPTY`, `TOO_MANY_LINES`,
`PRODUCT_UNAVAILABLE`, `PACK_NOT_FOUND`, `BAD_QUANTITY`, `QUANTITY_LIMIT`,
`OUT_OF_STOCK` (409), `ZONE_UNAVAILABLE`, `PAYMENT_UNAVAILABLE`,
`ADVANCE_METHOD_UNAVAILABLE`, `NOT_SEEDED` (503).
Shopper-facing messages are in Bangla.

`site.payment.methods` (in `/api/storefront` and `/api/site`) is the list the
order form should offer: on in the dashboard AND reachable (a gateway method
with no keys in `.env` is left out). Manual wallets carry `number`,
`accountType` and `instructions`; gateway bKash carries no number.

## API: orders and payments (Phase 2)

### Shopper

| Method | Path | Notes |
|---|---|---|
| POST | `/api/orders` | create, see below; 201 |
| GET | `/api/orders/:orderNumber` | header `X-Order-Token`; `{ success, order }` |
| POST | `/api/orders/:orderNumber/pay` | header `X-Order-Token`; new gateway session, `{ success, nextAction }` |
| POST | `/api/orders/:orderNumber/payment` | header `X-Order-Token`, `{ trxId, senderNumber }`; only after the shop rejected a TrxID |

`POST /api/orders` body: the calculate body plus `name`, `phone`, `address`,
`note?`, `trxId?` and `senderNumber?` (required when `requiresTrxId`),
`clientRequestId?` (a UUID made once per form submit; a retry with the same id
returns the first order instead of a duplicate), `website` (honeypot, keep it
hidden and empty).

```js
201 { success, orderNumber, guestAccessToken, order, nextAction }
// nextAction: null
//           | { type: "redirect", url }   go to bKash / SSLCommerz now
//           | { type: "retry_payment" }   gateway did not open; offer "Pay now"
//                                         (POST /api/orders/:n/pay)
```

Save `orderNumber` + `guestAccessToken` (localStorage) BEFORE redirecting to a
gateway. The token is shown once (only its hash is stored); the order page
sends it as the `X-Order-Token` header, never in the URL. Unknown order and
wrong token both answer 404.

Errors with a `code`: everything from calculate, plus `PHONE_LIMIT` (429, 3
orders per phone per hour), `TRXID_REQUIRED`, `SENDER_REQUIRED`, `TRXID_USED`
(409, the TrxID is on another order), `NOTHING_TO_PAY`, `NOT_REJECTED`,
`GATEWAY_ERROR`.

Public `order`: `orderNumber, createdAt, orderStatus, paymentStatus,
paymentMethod, payNowVia, items[], itemsPrice, shippingPrice, totalPrice,
savings, payNow, payOnDelivery, amountPaid, shippingAddress, customerNote,
manualPayment { method, trxId, rejectReason }, canRetryPayment,
canResubmitTrxId, statusHistory[{ status, updatedAt }]`.

### Payment flows

| Method | Flow | How it is confirmed |
|---|---|---|
| COD | cash to courier | `Delivered` in the dashboard marks it Paid |
| bKash / Nagad, manual | shopper sends money, types TrxID | shop checks the wallet app, then Verify or Reject |
| bKash, gateway mode | bKash Tokenized Checkout | API executes and checks status, amount, invoice |
| Online | SSLCommerz hosted page | API calls the SSLCommerz validation API (amount, currency, tran_id) |

A COD order can be asked for the delivery charge in advance
(`codAdvance: "delivery"`); the advance goes through any prepaid method above.

`paymentStatus`: `Pending` → (`Verifying`) → `Advance Paid` | `Paid`, or
`Failed` (TrxID rejected), `Refunded` (bookkeeping). A gateway failure leaves
the order `Pending` with `gatewayPayment.lastError`, and the shopper can retry.
Cards SSLCommerz flags as risky stop at `Verifying` for a manual check.

Gateway endpoints (called by the gateways, not the storefront; mounted before
CORS): `GET /api/payments/bkash/callback`, `POST /api/payments/sslcommerz/success|fail|cancel|ipn`.
Browser endings redirect (303) to
`STOREFRONT_URL/order/<orderNumber>?payment=success|failed|cancelled|review`.

Going live: fill the keys in `.env`, set `API_PUBLIC_URL` to the public https
API URL, then turn the method on in the dashboard (bKash mode `gateway`, or
Online on). For SSLCommerz, also set the IPN URL in the merchant panel to
`<API_PUBLIC_URL>/api/payments/sslcommerz/ipn`.

### Dashboard (Bearer token)

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/admin/orders` | `status, paymentStatus, paymentMethod, q, from, to, page, limit` → `{ orders, total, totalPages, currentPage, statusCounts, needsAttention }` |
| GET | `/api/admin/orders/export` | same filters → CSV (UTF-8 BOM, max 5000 rows) |
| GET | `/api/admin/orders/:orderNumber` | `{ order, customer }` (customer = phone history) |
| PATCH | `/api/admin/orders/:orderNumber/status` | `{ status, note? }`; may return `warning` |
| PATCH | `/api/admin/orders/:orderNumber/payment` | `{ action: "verify"\|"reject"\|"refunded", reason? }` |
| POST | `/api/admin/orders/:orderNumber/payment/recheck` | asks the gateway again (closed tab, missed IPN) |
| POST | `/api/admin/orders/:orderNumber/notes` | `{ note }` |
| GET | `/api/admin/customers` | `q, page, limit` |

`q` matches an order number prefix, a phone number, a TrxID or a name.
Status flow: Pending → Confirmed | Cancelled; Confirmed → Processing | Shipped |
Cancelled; Processing → Shipped | Cancelled; Shipped → Delivered | Cancelled
(returned). Confirming a prepaid/advance order needs its payment in. Stock is
deducted on Confirmed (or at order time with `STOCK_DEDUCT_ON=placed`) and
returned on Cancelled.

## Layout

```
server.js            boot: env check, DB, listen, graceful shutdown
app.js               Express app and middleware order (exported for tests)
config/              env (validated at boot), db
middlewares/         sanitize, rateLimiter, auth, validate, error
models/              User, Product, SiteSettings, LandingPage, Order, Customer, Counter
services/pricing.js  the only place totals are computed
services/paymentMethods.js  which methods are on and how each is collected
services/publicShape.js  what the storefront is allowed to see
services/payments/   bKash Tokenized, SSLCommerz, orchestration (index.js)
services/            stock, orderNumber (+ guest token), customers, mailer
controllers/ routes/ storefront, checkout, orders, payment callbacks, admin
seed/                defaults.js (copy of the storefront defaults), build.js
scripts/             seed.js, createAdmin.js
tests/               pricing, models, http, gateways (no DB); api, orders (DB)
```

See `HANDOVER.md` for status and the phase plan, `CLAUDE.md` for the traps.
