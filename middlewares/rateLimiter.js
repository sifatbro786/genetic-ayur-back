// middlewares/rateLimiter.js
// Limits are keyed on req.ip, so TRUST_PROXY must match the real proxy setup
// (config/env.js). Phase 2 adds orderLimiter and trackingLimiter here.
import rateLimit from "express-rate-limit";

const jsonHandler = (_req, res) => {
    res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
};

const make = (windowMs, limit, extra = {}) =>
    rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, handler: jsonHandler, ...extra });

// Everything under /api. A landing page visit is 1 to 3 requests, so 120 a
// minute never touches a real shopper and still blunts scraping.
export const globalApiLimiter = make(60 * 1000, 120);

// Admin login. Only failed attempts count, so the shop owner logging in on a
// shared office IP all day never locks themselves out; a password spray does.
export const authLimiter = make(15 * 60 * 1000, 10, { skipSuccessfulRequests: true });

// Checkout preview is called on every pack/zone/quantity change in the order
// form. Generous, but stops someone using it to probe stock levels in a loop.
export const calculateLimiter = make(60 * 1000, 60);
