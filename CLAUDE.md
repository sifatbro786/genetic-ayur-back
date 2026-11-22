# Genetic Ayur API: working context

Read `HANDOVER.md` first (status, phase plan, open questions), then `README.md`
(API contract). Storefront repo: `../genetic-ayur-front` (has its own CLAUDE.md).
Pattern source: the Footpath base (`footpath-backend`). This is a lean build on
that pattern, not a copy: no categories, cart, coupons, campaigns or user
accounts. Payments: COD, manual bKash/Nagad (TrxID), and optional bKash
Tokenized Checkout and SSLCommerz switched on by keys in `.env`.

## Rules that must hold

- **Money is decided only in `services/pricing.js`.** `priceCart()` is pure and
  tested; `quoteOrder()` loads data and calls it. Calculate shows its numbers;
  createOrder charges by calling `quoteOrder()` again, never by
  reading prices or totals from the request.
- **Variants have no _id.** Identity is the `options` array, compared with
  `utils/variants.js` (trim, lowercase, sort by name). Product validation
  refuses two packs with the same key.
- **Stock is counted in single units on the product**, and a pack has `units`
  (a 2 jar combo has `units: 2`). Stock checks sum units per product across
  lines. Never decrement per line by quantity alone.
- **Raw stock never goes to the storefront.** `services/publicShape.js` turns it
  into `maxQuantity` / `inStock`. Disabled wallet numbers and hidden landing
  sections are also stripped there.
- **Repeated lines are merged before limits** (`MAX_QTY_PER_LINE`, `MAX_LINES`).
- **Middleware order in `app.js`:** sanitize before hpp (Express 5 `req.query`
  getter). Literal routes before `/:param` routes.
- **CORS:** requests without an Origin header pass without CORS headers (Next.js
  server rendering needs that); a browser Origin not in `CLIENT_URL` gets 403.
- **Express 5 handles rejected promises in async handlers.** No asyncHandler
  wrapper needed.
- **Dashboard auth:** JWT carries `tokenVersion`; changing a password bumps it
  and signs out every other session. No public register route.
- **Payments are confirmed only from the gateway's own answer** fetched by
  this server (bKash execute/status, SSLCommerz validation API), with amount
  = `payNow`, currency BDT, matching invoice/tran_id. Callback and IPN bodies
  are hints. Failure callbacks change nothing but `lastError` (anyone can POST
  them). Marking paid is one conditional update (callback + IPN race).
- **Gateway callbacks are mounted before CORS** (`/api/payments`): the
  SSLCommerz page posts back with its own Origin.
- **Guest token:** 48 hex, only its SHA-256 is stored, sent as the
  `X-Order-Token` header (never in a URL). Unknown order and wrong token are
  the same 404.
- **Order state changes are conditional on the state read** (`orderStatus:
  from`, `paymentStatus: from`); stock uses the `stockDeducted` claim flag.
- A gateway method without keys in `.env` is hidden
  (`services/paymentMethods.js`), never offered and then failed.
- **Stock changes only through `services/stock.js`** (orders, the stock
  endpoint): conditional `$inc`, then a `StockMovement` ledger line. Product
  edits ignore `stock`.
- **Landing sections are validated by `services/landingSchema.js`**, the twin
  of the front's `lib/schema.js`. A new section field needs a line in both.
- **Uploads are always re-encoded by sharp** (never stored as sent). Images in
  any model/section must pass `utils/url.js` `isSafeImageUrl`.
- System-generated status or note entries omit `updatedBy`/`addedBy` (Footpath
  trap: the string "system" silently vanishes on an ObjectId field).
- No PII in logs: use `utils/logger.js` `debug()`.

## Conventions

ES modules. Controllers return `{ success, ... }`. Validation with
express-validator on every write route, then `middlewares/validate.js`.
Shopper-facing messages in Bangla, dashboard messages in English. Comments
explain why. Check syntax with esbuild and run `npm test` before delivering.
