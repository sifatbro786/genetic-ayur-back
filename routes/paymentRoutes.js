// routes/paymentRoutes.js — mounted in app.js BEFORE cors: SSLCommerz posts
// the shopper's browser back with an Origin header from its own domain, which
// the storefront-only CORS rule would refuse. These handlers trust nothing in
// the request anyway (see controllers/paymentController.js).
import express, { Router } from "express";
import { bkashCallback, sslFail, sslIpn, sslSuccess } from "../controllers/paymentController.js";
import { paymentCallbackLimiter } from "../middlewares/rateLimiter.js";
import { sanitizeRequest } from "../middlewares/sanitize.js";

const router = Router();

router.use(paymentCallbackLimiter);
router.use(express.urlencoded({ extended: false, limit: "50kb" }));
router.use(sanitizeRequest);

router.get("/bkash/callback", bkashCallback);
router.post("/sslcommerz/success", sslSuccess);
router.post("/sslcommerz/fail", sslFail("failed"));
router.post("/sslcommerz/cancel", sslFail("cancelled"));
router.post("/sslcommerz/ipn", sslIpn);

export default router;
