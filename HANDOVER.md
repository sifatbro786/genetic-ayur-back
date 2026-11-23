# HANDOVER: Genetic Ayur backend

Last updated: 2026-11-23, Phase 5: LIVE at https://geneticayur.com (API at https://api.geneticayur.com). Next: backups, client open questions, then improvements.

## Context

- Client: Genetic Ayur, herbal brand. One product today (Kasturi Active Power,
  slug `kasturi-active-power`); could grow to 15 to 20 products, so every list
  (API and storefront) must work for that many.
- Storefront: `E:\Works\Genetic-Ayur\genetic-ayur-front` (Next.js 16 with Cache
  Components, React 19, Tailwind v4). Landing page, product pages, order page
  and the `/admin` dashboard, all on this API since Phase 4. The client
  approved the design.
- Backend: `E:\Works\Genetic-Ayur\genetic-ayur-back` (this repo), Express 5 +
  MongoDB. Built on the Footpath pattern (`D:\Projects\footpath\footpath-backend`)
  but lean.
- Payment: COD and manual bKash/Nagad (shopper sends money, types the TrxID,
  shop verifies) work today with no keys. bKash Tokenized Checkout and
  SSLCommerz are built in and switch on when their keys are in `.env` (the
  client has neither account yet).
- Hosting (live since 2026-11-23): storefront, dashboard and API all on the
  client's Hostinger VPS (pm2 + nginx + Let's Encrypt), MongoDB Atlas M0.
  Vercel is no longer used. See "Production (live)" below.

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

### Phase 4: storefront wiring (DONE)

Storefront (`genetic-ayur-front`):
- `lib/api/storefront.js`: one server read of `/api/storefront` with
  `"use cache"`, `cacheTag("storefront")`, 5 minute revalidate as a safety
  net. A failed fetch throws (last good copy keeps serving; never placeholder
  prices). The build needs the API reachable.
- `POST /api/revalidate`: checks `x-revalidate-secret` (hashed, timing safe),
  accepts up to 10 `[a-z0-9:_-]` tags, `revalidateTag(tag, { expire: 0 })` so
  the next visit gets the new content.
- Landing page, legal pages, metadata and 404 render from API data on the
  server. Static demo stores (`lib/stores.js`, `lib/orders.js`,
  `lib/pricing.js`) deleted.
- Order form: numbers only from calculate (debounced, stale answers ignored),
  product picker when more than one product is active, payment method choice
  from `site.payment.methods`, COD advance method choice, manual bKash/Nagad
  box (number, Send Money / Cash Out / Payment wording, TrxID + sender),
  `clientRequestId` per attempt, hidden `website` honeypot, server field
  errors shown next to inputs, re-quote on stock/pack/zone errors. Token saved
  in localStorage before a gateway redirect.
- `/order/[orderNumber]`: token from localStorage as `X-Order-Token`,
  `?payment=` banner, timeline, Pay again, resend TrxID after a rejection.
- `/products/[slug]` (prerendered for known slugs, others on first visit) and
  the `products` landing section (grid, hidden while only one product exists).
- Dashboard: JWT login, sidebar counts (pending + payments to verify), orders
  with URL filters, search, dates, paging, CSV export and an order panel
  (verify/reject TrxID, refunded, gateway recheck, status buttons from
  STATUS_FLOW, notes, phone history); products list with search/paging, create,
  edit, hide, stock panel with the movement ledger; landing page editor with
  every section key and the landing product picker; settings with payments
  (COD, bKash manual/gateway, Nagad, SSLCommerz, COD advance), SEO, gateway key
  status and warnings, password change. Images upload to `/api/admin/uploads`.

Backend changes in Phase 4:
- `utils/url.js`: `http://localhost` / `127.0.0.1` image URLs are accepted
  outside production, so uploads work on a dev machine (`API_PUBLIC_URL` is
  http there). Production still accepts only https and `/paths`.
- `config/env.js`: production refuses to start without an https
  `API_PUBLIC_URL` (uploaded image URLs are built from it).
- `services/stock.js`: confirm/cancel stock changes call the storefront
  revalidate, so a sold out pack stops being offered.
- Tests: 49 run without a database (adds the local upload URL rule). DB suites
  still need `npm test` on your machine.

Checked in Phase 4: lint clean, `next build` passes against a mock API built
from this repo's seed and public shapes; a headless browser placed a bKash
manual order through the form, opened the order page with and without the
token, and drove the dashboard (login, verify payment, confirm, note, product
save, stock change, landing save, settings save). Not yet run against a real
database: do the end-to-end test below before launch.

### Phase 5: go live (DONE 2026-11-23)

Site is live. Plan changed from the earlier draft: the storefront is NOT on
Vercel; everything runs on the VPS (see "Production (live)").

End-to-end checks to keep doing after any release:
1. COD order and a bKash manual order (wrong TrxID, reject, resend), then
   confirm, ship, deliver in the dashboard. Check the stock ledger.
2. Change a price and a landing text; the live page shows it on the next
   reload (revalidate route working).
3. Upload a logo and a product photo; they load from `https://api.geneticayur.com/uploads/...`.
4. Turn on bKash/Nagad with the client's real numbers.

Still to do after launch:
- Backups: Atlas M0 has none. Nightly `mongodump` cron on the VPS (needs
  `mongodb-database-tools`) plus the uploads folder, kept off the server too.
- fail2ban for SSH (root logs in with a password).
- Uptime check on `https://api.geneticayur.com/health` and the home page.
- Production uses the dev database (`genetic-ayur`): remove or cancel any
  test orders left from development.
- Both GitHub repos are public. Making them private needs a deploy key on the
  VPS for `git pull`.
- Storefront `npm audit`: 7 moderate, all in dev/build tooling (eslint chain);
  nothing in the runtime. Review on the next dependency update.

## Production (live)

| | |
|---|---|
| Domain | `geneticayur.com` (Namecheap, client's account) |
| DNS | A `@`, `www`, `api` → `189.72.178.94` (Namecheap Advanced DNS) |
| VPS | Hostinger KVM 1 (1 vCPU, 4 GB RAM, 50 GB), Mumbai, Ubuntu 26.04 LTS, 2 GB swap, timezone Asia/Dhaka |
| Runtime | Node 24 LTS (NodeSource), pm2 7, nginx 1.28, certbot (webroot) |
| Database | MongoDB Atlas M0, database `genetic-ayur`; VPS IP allowed in Atlas Network Access |
| Firewall | ufw: OpenSSH, Nginx Full (80/443) only. Node ports are bound to localhost |

Layout on the VPS (apps run as the non-root user `deploy`):

```
/var/www/geneticayur/
  back/      genetic-ayur-back  (git clone, .env chmod 600)  pm2: ga-api  127.0.0.1:5000
  front/     genetic-ayur-front (git clone, .env chmod 600)  pm2: ga-web  127.0.0.1:3000
  uploads/   UPLOAD_DIR, outside both repos (back this up)
```

- nginx: `/etc/nginx/sites-available/geneticayur` (default site removed).
  `http` → `https`; `www` → apex 301; apex → `ga_web`; `api.` → `ga_api`
  (`client_max_body_size 10m` for uploads). HSTS on the apex. `server_tokens off`
  is set in `/etc/nginx/nginx.conf` (Ubuntu ships the directive there; adding
  it again in the site file is a duplicate error).
- SSL: one Let's Encrypt cert for all three names
  (`/etc/letsencrypt/live/geneticayur.com/`), renewed by `certbot.timer`
  through `/var/www/html/.well-known`, deploy hook reloads nginx. Dry run passed.
- pm2 starts at boot: systemd unit `pm2-deploy` (`pm2 save` after any process change).
- API `.env` (production): `NODE_ENV=production`, `TRUST_PROXY=1` (nginx is
  one hop), `CLIENT_URL=https://geneticayur.com,https://www.geneticayur.com`,
  `STOREFRONT_URL=https://geneticayur.com`, `API_PUBLIC_URL=https://api.geneticayur.com`,
  `REVALIDATE_URL=http://127.0.0.1:3000/api/revalidate` (same machine, no
  round trip through nginx), `UPLOAD_DIR=/var/www/geneticayur/uploads`,
  production-only `JWT_SECRET` and `REVALIDATE_SECRET` (not the dev ones),
  Gmail SMTP, bKash keys empty (manual mode). No `ADMIN_*` lines.
- Storefront `.env`: `NEXT_PUBLIC_API_URL=https://api.geneticayur.com` (baked
  in at build time), `API_URL=http://127.0.0.1:5000` (server-side fetches stay
  on the machine), `NEXT_PUBLIC_SITE_URL=https://geneticayur.com`,
  `REVALIDATE_SECRET` copied from the API `.env`.
- Dashboard accounts: `node scripts/createAdmin.js <email> "<password>" "<name>"`
  from `back/` (direct node call, so npm does not echo the arguments).

### Releasing an update

Push to `main` on GitHub, then on the VPS:

```bash
ssh root@189.72.178.94
su - deploy

# API
cd /var/www/geneticayur/back
git pull && npm ci --omit=dev && pm2 reload ga-api

# Storefront (the API must be up: the build reads /api/storefront)
cd /var/www/geneticayur/front
git pull && npm ci && NODE_OPTIONS=--max-old-space-size=2048 npm run build && pm2 reload ga-web

pm2 status
curl -s https://api.geneticayur.com/health
```

- `next build` writes into `.next` while `ga-web` is still serving, so the
  site can error during the build (about a minute). Fine at this traffic; if
  it matters later, build into a second folder and swap.
- A new env var: edit `.env`, then `pm2 reload <name> --update-env`. A new
  `NEXT_PUBLIC_*` value needs a rebuild.
- Logs: `pm2 logs ga-api --lines 100`, `pm2 logs ga-web`, nginx in `/var/log/nginx/`.

## Open questions for the client

1. bKash and Nagad numbers, and whether each is personal, agent or merchant.
   (Entered in the dashboard Settings in Phase 3/4.)
2. Should COD orders pay the delivery charge in advance (`codAdvance:
   "delivery"`)? Cuts fake orders, lowers conversion. Default is off.
3. Stock: built as recommended (deduct on Confirmed). Confirm with the client.
4. New order alert email: live `ORDER_NOTIFY_TO` is jahangirsb81@gmail.com with
   its App Password set. Switch to a shop address if the client wants one.
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

API `.env`: Atlas URI, generated `JWT_SECRET` and `REVALIDATE_SECRET`,
`REVALIDATE_URL=http://localhost:3000/api/revalidate`. Storefront `.env`:
`NEXT_PUBLIC_API_URL=http://localhost:5000`, the same `REVALIDATE_SECRET`.
Still to fill: `SMTP_PASS` (Gmail App Password), gateway keys when the client
gets them (`BKASH_*`, `SSLCZ_*`). `ADMIN_PASSWORD` in the API `.env` is a
throwaway: create the account, change the password in Dashboard > Settings,
then delete the line. For SSLCommerz sandbox testing, a free sandbox store from
developer.sslcommerz.com works with `SSLCZ_SANDBOX=true` (needs a public
`API_PUBLIC_URL`, e.g. ngrok). Never point `MONGODB_TEST_URI` at the Atlas
database: the tests wipe it.
