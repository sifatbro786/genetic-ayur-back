import { Router } from "express";
import { body } from "express-validator";
import { calculate } from "../controllers/checkoutController.js";
import { calculateLimiter } from "../middlewares/rateLimiter.js";
import { validate } from "../middlewares/validate.js";
import { MAX_LINES, MAX_QTY_PER_LINE } from "../services/pricing.js";
import { PAYMENT_METHODS, ZONE_KEYS } from "../models/SiteSettings.js";

// Shared with Phase 2's createOrder route: same item rules for preview and order.
export const itemRules = [
    body("items").isArray({ min: 1, max: MAX_LINES }).withMessage("কোনো পণ্য বেছে নেওয়া হয়নি।"),
    body("items.*.slug").isString().trim().isSlug().isLength({ max: 80 }).withMessage("পণ্যটি সঠিক নয়।"),
    body("items.*.options").isArray({ min: 1, max: 5 }).withMessage("প্যাক বেছে নিন।"),
    body("items.*.options.*.name").isString().isLength({ min: 1, max: 40 }),
    body("items.*.options.*.value").isString().isLength({ min: 1, max: 60 }),
    body("items.*.quantity")
        .isInt({ min: 1, max: MAX_QTY_PER_LINE })
        .withMessage(`পরিমাণ ১ থেকে ${MAX_QTY_PER_LINE} এর মধ্যে হতে হবে।`)
        .toInt(),
    body("zone").isIn(ZONE_KEYS).withMessage("ডেলিভারি এলাকা নির্বাচন করুন।"),
    body("paymentMethod").optional().isIn(PAYMENT_METHODS).withMessage("পেমেন্ট পদ্ধতি সঠিক নয়।"),
    body("advanceMethod").optional().isIn(PAYMENT_METHODS.filter((m) => m !== "COD")).withMessage("পেমেন্ট পদ্ধতি সঠিক নয়।"),
];

const router = Router();

router.post("/calculate", calculateLimiter, itemRules, validate, calculate);

export default router;
