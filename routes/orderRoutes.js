import { Router } from "express";
import { body, param } from "express-validator";
import { createOrder, getMyOrder, resubmitTrxId, retryPayment } from "../controllers/orderController.js";
import { orderLimiter, trackingLimiter } from "../middlewares/rateLimiter.js";
import { validate } from "../middlewares/validate.js";
import { ORDER_NUMBER_RE } from "../services/orderNumber.js";
import { normalizeBdPhone } from "../utils/phone.js";
import { itemRules } from "./checkoutRoutes.js";

const PHONE_MSG = "১১ সংখ্যার সঠিক মোবাইল নম্বর লিখুন (যেমন 017XXXXXXXX)";
// bKash TrxIDs are 10 letters/digits, Nagad 8; a little slack either way.
const TRX_RE = /^[A-Za-z0-9]{6,20}$/;
const trxRule = (opt) => {
    const chain = body("trxId");
    return (opt ? chain.optional({ values: "falsy" }) : chain).isString().trim().matches(TRX_RE).withMessage("TrxID সঠিক নয়।");
};
const senderRule = (opt) => {
    const chain = body("senderNumber");
    return (opt ? chain.optional({ values: "falsy" }) : chain).custom((v) => Boolean(normalizeBdPhone(v))).withMessage(PHONE_MSG);
};

const orderNumberRule = param("orderNumber").matches(ORDER_NUMBER_RE).withMessage("অর্ডারটি খুঁজে পাওয়া যায়নি।");

const router = Router();

router.post(
    "/",
    orderLimiter,
    itemRules,
    body("name").isString().trim().isLength({ min: 2, max: 80 }).withMessage("আপনার নাম লিখুন"),
    body("phone").custom((v) => Boolean(normalizeBdPhone(v))).withMessage(PHONE_MSG),
    body("address")
        .isString()
        .trim()
        .isLength({ min: 10, max: 300 })
        .withMessage("বাসা, রোড, এলাকা ও জেলাসহ পুরো ঠিকানা লিখুন"),
    body("note").optional().isString().trim().isLength({ max: 500 }).withMessage("নোট ৫০০ অক্ষরের মধ্যে লিখুন"),
    trxRule(true),
    senderRule(true),
    body("clientRequestId").optional().isString().matches(/^[A-Za-z0-9-]{16,64}$/),
    body("website").optional().isString().isLength({ max: 200 }),
    validate,
    createOrder,
);

router.get("/:orderNumber", trackingLimiter, orderNumberRule, validate, getMyOrder);
router.post("/:orderNumber/pay", trackingLimiter, orderNumberRule, validate, retryPayment);
router.post("/:orderNumber/payment", trackingLimiter, orderNumberRule, trxRule(false), senderRule(false), validate, resubmitTrxId);

export default router;
