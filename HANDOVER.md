# HANDOVER: Genetic Ayur backend

Last updated: 2026-11-22, end of Phase 1.

## Context

- Client: Genetic Ayur, herbal brand. One product today (Kasturi Active Power,
  slug `kasturi-active-power`), 3 to 5 more planned.
- Storefront: `D:\Projects\Genetic Ayur\genetic-ayur-front` (Next.js 16, React 19,
  Tailwind v4). Landing page + `/admin` dashboard. Still static: all data in
  localStorage through `lib/stores.js`, seeded from `lib/defaults.js`. The
  client approved this design.
- Backend: `D:\Projects\Genetic Ayur\genetic-ayur-back` (this repo), Express 5 +
  MongoDB. Built on the Footpath pattern (`D:\Projects\footpath\footpath-backend`)
  but lean.
- Payment: no SSLCommerz. Cash on delivery, and manual bKash/Nagad: the shopper
  sends money from their own app and types the TrxID; the shop verifies it.
- Hosting plan: API on the STR Solutions VPS (pm2 + nginx), storefront on
  Vercel, MongoDB Atlas.

## What was kept from Footpath, and what was dropped

Kept (as code or as rule): sanitize-before-hpp pipeline, helmet, rate limiters,
express-validator on every write, server-side pricing, variant identity by
options, redacting logger, BD phone normaliser, zone keys
(`dhaka_inside`/`dhaka_sub`/`outside_dhaka`), Order field names (Phase 2), guest
access token for order lookup (Phase 2), stock ledger idea (Phase 3).

Dropped: categories and category tree, attributes/filters, cart and cart merge,
coupons, campaigns and the campaign cron, A+ content, hero/navbar/offer popup
models, wishlist, customer accounts and OTP, SSLCommerz, district/upazila
tables and courier branches, weight-based shipping, tax.

## Phase plan

### Phase 1: foundation and read API (DONE)

- Project scaffold, env check at boot, graceful shutdown, `/health`.
- Security pipeline: compression, helmet, CORS (env origins), JSON 1 MB,
  sanitize, hpp, global + auth + calculate rate limiters, one error shape.
- Models: `User` (dashboard only, tokenVersion), `Product` (multi-product ready,
  pack `units`), `SiteSettings` (zones, payment: COD/bKash/Nagad/codAdvance),
  `LandingPage` (order + Mixed sections + productSlug).
- `services/pricing.js`: merged lines, per line cap 10, max 10 lines, stock by
  units per product, free shipping pack frees the parcel, payNow/payOnDelivery.
- Public: `/api/storefront`, `/api/site`, `/api/landing`, `/api/products`,
  `/api/products/:slug`, `POST /api/checkout/calculate`.
- Admin auth: login, me, change password. `npm run admin:create`.
- Seed from a copy of the storefront defaults: `npm run seed` / `seed:force`.
- Tests: 21 passing (pricing, models, HTTP), 8 DB tests that run where an
  in-memory MongoDB can download (they skipped in the build sandbox, so run
  `npm test` locally once).

### Phase 2: orders and manual payment (NEXT)

- `Order` model with Footpath field names (`orderItems`, `shippingAddress`,
  `orderStatus`, `paymentStatus`, `statusHistory`) plus `manualPayment
  { method, senderNumber, trxId, amount, verifiedAt, verifiedBy }`.
  Order number `GA` + `YYMMDD` + sequence via an atomic counter (not
  countDocuments, which races).
- `POST /api/orders`: same `itemRules` as calculate, plus name, phone
  (normalised), address, note, honeypot field. Re-prices with `quoteOrder()`.
  When `payNow > 0`: TrxID and sender number required; TrxID unique across
  orders (sparse unique index) so one payment cannot back two orders.
  Returns `orderNumber` + `guestAccessToken` (48 hex, select:false).
- `orderLimiter` (per IP) and a per phone cap (example: 3 orders an hour).
- `GET /api/orders/:orderNumber?token=` for the success/status page.
- New order email to the shop (Gmail SMTP, fire and forget, never blocks the
  order). Customer book upsert by phone.
- Admin: list (status, payment, search, date), detail, status change with
  history, verify or reject payment, admin notes, CSV export.
- Stock: decide timing (see open questions). Atomic conditional `$inc` on
  `stock` with `{ stock: { $gte: needed } }`, restored on cancel.

### Phase 3: dashboard write API

- `PUT /api/admin/site` (validated by the model), `PUT /api/admin/landing` with
  per section validation (allowed keys, lengths, list sizes; Mixed field).
- Products CRUD (`/api/admin/products`), soft delete via `isActive`, stock
  adjust with a `StockMovement` ledger; product edits never write stock.
- Image upload: multer memory + sharp to WebP, size and type limits, served
  from `/uploads` (VPS disk) with long cache headers.
- On every content save, call the storefront's revalidate endpoint
  (`REVALIDATE_URL` + secret) so Vercel refreshes the cached page at once.

### Phase 4: storefront wiring and launch

- `genetic-ayur-front`: `lib/stores.js` reads from the API (server fetch of
  `/api/storefront` with revalidate tags on the landing page; client hooks for
  the dashboard). Delete `lib/pricing.js`; the order form calls calculate.
- Order form: product picker when more than one product is active, payment
  method choice, bKash/Nagad instructions with the number, TrxID + sender
  fields, success page by order number + token.
- Dashboard: real JWT login, pages switched to the admin API, payment
  verification UI.
- Multi-product: `products` landing section (grid of other products), and the
  order form preselects `landing.productSlug`.
- Deploy: Atlas, VPS (pm2, nginx, TLS, TRUST_PROXY=1), Vercel env
  (`NEXT_PUBLIC_API_URL`), CORS `CLIENT_URL`, uptime check on `/health`.

## Open questions for the client (ask before Phase 2 is finished)

1. bKash and Nagad numbers, and whether each is personal, agent or merchant.
2. Should COD orders pay the delivery charge in advance (`codAdvance:
   "delivery"`)? It cuts fake orders but lowers conversion. Default is off.
3. Stock deduction: at order placement, or when the shop confirms by phone?
   Recommendation: check at placement, deduct on Confirmed, restore on
   Cancelled (fake COD orders then never lock stock).
4. Which email receives new order alerts.

## Decisions worth knowing

- Storefront shape is the contract. `seed/defaults.js` is a copy of the
  storefront's `lib/defaults.js`; the DB is the source of truth after seeding.
- `payment` was not in the storefront defaults; `seed/build.js` adds it
  (COD on, wallets off until numbers are entered).
- Response envelopes are uniform here (unlike Footpath): `{ success, <name> }`.
- Public GETs send `Cache-Control: public, max-age=30, stale-while-revalidate=120`.
- Images in the seed are storefront-relative paths (`/images/...`). Uploaded
  images in Phase 3 will be absolute URLs; the storefront must accept both.

## Local setup reminder

`.env` was created with a generated `JWT_SECRET`, local Mongo URI and
`CLIENT_URL=http://localhost:3000`. Fill in the Atlas URI and the Gmail App
Password before Phase 2 testing.
