# Genetic Ayur API

Backend for the Genetic Ayur landing-page store (`genetic-ayur-front`, Next.js).
Express 5 + MongoDB/Mongoose. It follows the STR Solutions Footpath base
(security middleware, server-side pricing, variant identity, guest order tokens)
but leaves out what a 1 to 5 product store with no gateway does not need.

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

## API (Phase 1)

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
are accepted). `paymentMethod` is `COD`, `bKash` or `Nagad`.

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
  payNow,          // to send by bKash/Nagad before the order is processed
  payOnDelivery,   // cash to the courier
  requiresTrxId    // true when payNow > 0
}
```

Business errors from calculate carry a `code`: `EMPTY`, `TOO_MANY_LINES`,
`PRODUCT_UNAVAILABLE`, `PACK_NOT_FOUND`, `BAD_QUANTITY`, `QUANTITY_LIMIT`,
`OUT_OF_STOCK` (409), `ZONE_UNAVAILABLE`, `PAYMENT_UNAVAILABLE`, `NOT_SEEDED` (503).
Shopper-facing messages are in Bangla.

## Layout

```
server.js            boot: env check, DB, listen, graceful shutdown
app.js               Express app and middleware order (exported for tests)
config/              env (validated at boot), db
middlewares/         sanitize, rateLimiter, auth, validate, error
models/              User, Product, SiteSettings, LandingPage
services/pricing.js  the only place totals are computed
services/publicShape.js  what the storefront is allowed to see
controllers/ routes/ storefront, checkout, admin auth
seed/                defaults.js (copy of the storefront defaults), build.js
scripts/             seed.js, createAdmin.js
tests/               pricing, models, http (no DB), api (DB)
```

See `HANDOVER.md` for status and the phase plan, `CLAUDE.md` for the traps.
