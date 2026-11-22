# HANDOVER: Genetic Ayur backend

Last updated: 2026-11-23, end of Phase 3 (code done; run `npm test` locally, see below).

## Context

- Client: Genetic Ayur, herbal brand. One product today (Kasturi Active Power,
  slug `kasturi-active-power`); could grow to 15 to 20 products, so every list
  (API and storefront) must work for that many.
- Storefront: `D:\Projects\Genetic Ayur\genetic-ayur-front` (Next.js 16, React 19,
  Tailwind v4). Landing page + `/admin` dashboard. Still static: all data in
  localStorage through `lib/stores.js`, seeded from `lib/defaults.js`. The
  client approved this design.
- Backend: `D:\Projects\Genetic Ayur\genetic-ayur-back` (this repo), Express 5 +
  MongoDB. Built on the Footpath pattern (`D:\Projects\footpath\footpath-backend`)
  but lean.
- Payment: COD and manual bKash/Nagad (shopper sends money, types the TrxID,
  shop verifies) work today with no keys. bKash Tokenized Checkout and
  SSLCommerz are built in and switch on when their keys are in `.env` (the
  client has neither account yet).
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
models, wishlist, customer accounts and OTP, district/upazila
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

### Phase 2: orders and payments (DONE)

- Models: `Order` (Footpath field names; `payNowVia`, `manualPayment`,
  `gatewayPayment`, `stockDeducted`, hashed guest token), `Customer` (phone
  book with order/delivered/cancelled counts), `Counter` (atomic sequences).
- Order number `GA` + Dhaka date `YYMMDD` + daily sequence (`GA261122001`).
- `POST /api/orders`: same `itemRules` as calculate, re-priced with
  `quoteOrder()`, honeypot, per phone cap (3 an hour), `clientRequestId`
  idempotency (retry returns the first order with a rotated token), TrxID
  unique across orders.
- Shopper: order status by `X-Order-Token`, retry gateway payment, resubmit a
  rejected TrxID.
- Payments: `services/paymentMethods.js` decides what is on (dashboard
  settings AND keys present). Manual bKash/Nagad, bKash Tokenized Checkout
  (token cache + refresh, execute with status query fallback), SSLCommerz
  (init, validation API, tran_id lookup, IPN). Amount/currency/invoice are
  checked; duplicate payments are flagged for refund; risky cards are held.
- Dashboard: list with filters, search, status counts and a "payments to
  verify" count; detail with the phone's history; status changes with an
  allowed-transition table; verify/reject/refunded; gateway re-check; notes;
  CSV export (formula injection safe); customers list.
- Stock: checked at order time, deducted on Confirmed, returned on Cancelled
  (`STOCK_DEDUCT_ON=placed` switches to deduct at order time).
- Email alerts to the shop (new order, TrxID submitted, online payment
  received) via Gmail SMTP; skipped while `SMTP_PASS` is empty.
- Tests: 40 run without a database (pricing, models, HTTP, both gateway
  clients against a fake fetch). `tests/orders.test.js` (15 DB tests: every
  order, payment and admin flow above, gateways faked) and `api.test.js`
  need MongoDB: the in-memory download was blocked in the build sandbox, so
  **run `npm test` on your machine once** and fix anything red before Phase 3.

### Phase 3: dashboard write API (DONE)

- `GET/PUT /api/admin/site`: leaf by leaf update (one nested field never
  resets its siblings), model validation, `gateways` + `warnings` for methods
  that are on but have no keys.
- `GET/PUT /api/admin/landing`: per section cleaning with
  `services/landingSchema.js` (twin of the front's `lib/schema.js`), partial
  section saves, `productSlug` must be an active product, a `products` section
  for the multi-product grid.
- Products CRUD with search and pagination (built for 15 to 20+), auto slug,
  soft delete, landing product protected, slug rename moves the landing
  pointer. New fields `description` and `gallery` (max 8) for product pages.
- Stock ledger (`StockMovement`): opening stock, restock, damaged, correction,
  and the order flow (confirm/cancel) all write a line with the balance after.
- Image upload: multer (memory, 8 MB) + sharp re-encode to WebP, metadata
  stripped, size by kind, decompression bomb cap; served from `/uploads` with
  immutable caching and cross-origin CORP.
- Storefront revalidation call after every content, product and stock save
  (`REVALIDATE_URL` + `REVALIDATE_SECRET`; the route itself is Phase 4).
- Image/link URL rules in models (logo, product image/gallery, Facebook link).
- Dependencies: multer 2, sharp 0.35.5, nodemailer raised to 10.6 (v7 had
  high severity advisories). `npm audit --omit=dev`: 0.
- Tests: 48 run without a database (adds section cleaning, URL rules, image
  re-encoding, upload serving). `tests/admin.test.js` (11 DB tests) plus the
  Phase 2 DB suites run on your machine.

### Phase 4: storefront wiring and launch

- Storefront revalidate route: `POST /api/revalidate`, checks
  `x-revalidate-secret` against its own `REVALIDATE_SECRET` (same value as the
  API's), calls `revalidateTag` for each tag in `{ tags }`. Then set
  `REVALIDATE_URL=https://<storefront>/api/revalidate` in the API's `.env`.
- `next.config.mjs` `images.remotePatterns`: add the API host (`/uploads/**`)
  next to images.unsplash.com.
- Dashboard: image fields upload to `/api/admin/uploads` and store the URL;
  product page uses the stock endpoint (not the product form) and shows the
  movement history; products list with search/pagination.
- `genetic-ayur-front`: `lib/stores.js` reads from the API (server fetch of
  `/api/storefront` with revalidate tags on the landing page; client hooks for
  the dashboard). Delete `lib/pricing.js`; the order form calls calculate.
- Order form: product picker when more than one product is active, payment
  method choice from `site.payment.methods`, bKash/Nagad instructions with the
  number, TrxID + sender fields when `requiresTrxId`, `clientRequestId` per
  submit, hidden `website` honeypot. Save orderNumber + token in localStorage
  before following `nextAction.url`.
- New page `/order/[orderNumber]`: reads the token from localStorage, calls
  `GET /api/orders/:n` with `X-Order-Token`, shows `?payment=` result, "Pay
  again" (`canRetryPayment`) and "send TrxID again" (`canResubmitTrxId`).
- Dashboard: real JWT login, pages switched to the admin API, payment
  verification UI.
- Multi-product (up to 15 to 20): `products` landing section as a proper grid
  with a product page per slug (`/products/[slug]`, ISR), and the order form
  preselects `landing.productSlug`. Phase 3 admin products list needs
  pagination/search for that size.
- Deploy: Atlas, VPS (pm2, nginx, TLS, TRUST_PROXY=1), Vercel env
  (`NEXT_PUBLIC_API_URL`), CORS `CLIENT_URL`, uptime check on `/health`.

## Open questions for the client

1. bKash and Nagad numbers, and whether each is personal, agent or merchant.
   (Entered in the dashboard Settings in Phase 3/4.)
2. Should COD orders pay the delivery charge in advance (`codAdvance:
   "delivery"`)? Cuts fake orders, lowers conversion. Default is off.
3. Stock: built as recommended (deduct on Confirmed). Confirm with the client.
4. New order alert email: `ORDER_NOTIFY_TO` is geneticayur@gmail.com; needs the
   Gmail App Password in `SMTP_PASS`.
5. Do they want a bKash merchant (PGW) account or SSLCommerz later? Code is
   ready for both; only keys are missing.

## Decisions worth knowing

- Storefront shape is the contract. `seed/defaults.js` is a copy of the
  storefront's `lib/defaults.js`; the DB is the source of truth after seeding.
- `payment` was not in the storefront defaults; `seed/build.js` adds it
  (COD on, wallets off until numbers are entered).
- Response envelopes are uniform here (unlike Footpath): `{ success, <name> }`.
- Public GETs send `Cache-Control: public, max-age=30, stale-while-revalidate=120`.
- Payment trust model: see CLAUDE.md. Callback URLs are public; the server
  always asks the gateway itself before marking anything paid.
- Gateway callbacks redirect to `STOREFRONT_URL/order/<n>?payment=...`; the
  storefront must build that page in Phase 4.
- Existing databases need no migration for Phase 2: missing `payment.bkash.mode`
  reads as manual and missing `payment.online` as off.
- Nagad has no direct gateway here (its PGW needs RSA key exchange and a
  separate merchant contract); online Nagad goes through SSLCommerz.
- Refunds are recorded, not executed: done in the bKash/SSLCommerz panel, then
  "refunded" in the dashboard.
- `orderLimiter` is skipped when NODE_ENV=test (the suite places many orders
  from one IP); the per phone cap is tested instead.
- Product `stock` is ignored by PUT on purpose: the dashboard form that edits
  everything at once must not overwrite sales that happened while it was open.
- `/uploads` lives on the VPS disk: include `UPLOAD_DIR` in backups, and keep
  it outside the code folder if deploys replace that folder.
- Images in the seed are storefront-relative paths (`/images/...`). Uploaded
  images in Phase 3 will be absolute URLs; the storefront must accept both.

## Local setup reminder

`.env` has the Atlas URI and a generated `JWT_SECRET`. Still to fill:
`SMTP_PASS` (Gmail App Password), `API_PUBLIC_URL` (public https API URL once
deployed; use an ngrok URL to try the gateways locally), and gateway keys when
the client gets them (`BKASH_*`, `SSLCZ_*`). For SSLCommerz sandbox testing,
a free sandbox store from developer.sslcommerz.com works with the default
`SSLCZ_SANDBOX=true`. Never point `MONGODB_TEST_URI` at the Atlas database:
the tests wipe it.
