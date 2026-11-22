# Genetic Ayur API: working context

Read `HANDOVER.md` first (status, phase plan, open questions), then `README.md`
(API contract). Storefront repo: `../genetic-ayur-front` (has its own CLAUDE.md).
Pattern source: the Footpath base (`footpath-backend`). This is a lean build on
that pattern, not a copy: no categories, cart, coupons, campaigns, user
accounts or SSLCommerz.

## Rules that must hold

- **Money is decided only in `services/pricing.js`.** `priceCart()` is pure and
  tested; `quoteOrder()` loads data and calls it. Calculate shows its numbers;
  createOrder (Phase 2) must charge by calling `quoteOrder()` again, never by
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
- System-generated status or note entries omit `updatedBy`/`addedBy` (Footpath
  trap: the string "system" silently vanishes on an ObjectId field).
- No PII in logs: use `utils/logger.js` `debug()`.

## Conventions

ES modules. Controllers return `{ success, ... }`. Validation with
express-validator on every write route, then `middlewares/validate.js`.
Shopper-facing messages in Bangla, dashboard messages in English. Comments
explain why. Check syntax with esbuild and run `npm test` before delivering.
