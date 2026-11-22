// controllers/orderController.js — shopper side. Guest orders only; the
// shopper proves ownership of an order with the guest token (X-Order-Token).
import env from "../config/env.js";
import Order from "../models/Order.js";
import { recordNewOrder } from "../services/customers.js";
import { notifyNewOrder, notifyPaymentSubmitted } from "../services/mailer.js";
import { makeOrderNumber, newGuestToken, tokenMatches } from "../services/orderNumber.js";
import { canStartGateway, startGatewayPayment } from "../services/payments/index.js";
import { quoteOrder } from "../services/pricing.js";
import { toPublicOrder } from "../services/publicShape.js";
import { takeUnits, returnUnits } from "../services/stock.js";
import { normalizeBdPhone } from "../utils/phone.js";

// Orders per phone number per hour. Three covers a real shopper fixing a
// mistake; more is nearly always a prank or a competitor.
export const PHONE_ORDERS_PER_HOUR = 3;

const bad = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

const DUP_TRX = "এই TrxID দিয়ে আগেই একটি অর্ডার হয়েছে। সঠিক TrxID দিন অথবা আমাদের ফোন করুন।";

// Opens the gateway right away for prepaid gateway orders. A gateway hiccup
// does not lose the order: the shopper gets "retry_payment" and the order
// page offers the button again.
const nextActionFor = async (order) => {
    if (!canStartGateway(order)) return null;
    try {
        const { redirectUrl } = await startGatewayPayment(order);
        return { type: "redirect", url: redirectUrl };
    } catch (err) {
        console.error(`Gateway start failed for ${order.orderNumber}:`, err.message);
        return { type: "retry_payment" };
    }
};

// POST /api/orders
// Body: { items, zone, paymentMethod?, advanceMethod?, name, phone, address,
//         note?, trxId?, senderNumber?, clientRequestId?, website (honeypot) }
// 201 { success, orderNumber, guestAccessToken, order, nextAction }
//   nextAction: null | { type: "redirect", url } | { type: "retry_payment" }
export const createOrder = async (req, res) => {
    const b = req.body;
    res.set("Cache-Control", "no-store");

    // Honeypot: a hidden field real shoppers never fill. Bots get a dull
    // generic error, not a hint about why.
    if (b.website) return bad(res, 400, "অর্ডার নেওয়া যায়নি। আবার চেষ্টা করুন।");

    // Retry of a request that already created an order (double tap, flaky
    // mobile data). Same browser = same clientRequestId, so it gets the order
    // back with a fresh token instead of a duplicate order.
    if (b.clientRequestId) {
        const replay = await replayOrder(b.clientRequestId);
        if (replay) return res.status(200).json(replay);
    }

    const phone = normalizeBdPhone(b.phone);
    const since = new Date(Date.now() - 3600 * 1000);
    const recent = await Order.countDocuments({ "shippingAddress.phone": phone, createdAt: { $gte: since } });
    if (recent >= PHONE_ORDERS_PER_HOUR) {
        return bad(res, 429, "এই নম্বর থেকে অল্প সময়ে অনেক অর্ডার হয়েছে। দয়া করে আমাদের ফোন করুন।", "PHONE_LIMIT");
    }

    // The same function as /checkout/calculate: the shopper pays exactly what
    // they were shown, recomputed here from the database.
    const quote = await quoteOrder({ items: b.items, zoneKey: b.zone, paymentMethod: b.paymentMethod, advanceMethod: b.advanceMethod });
    if (!quote.ok) {
        const { status, ok: _ok, ...body } = quote;
        return res.status(status).json({ success: false, ...body });
    }
    const t = quote.totals;

    let manualPayment;
    if (t.requiresTrxId) {
        const trxId = String(b.trxId || "").trim().toUpperCase();
        const senderNumber = normalizeBdPhone(b.senderNumber);
        if (!trxId) return bad(res, 400, "পেমেন্টের TrxID লিখুন।", "TRXID_REQUIRED");
        if (!senderNumber) return bad(res, 400, "যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি লিখুন।", "SENDER_REQUIRED");
        if (await Order.exists({ "manualPayment.trxId": trxId })) return bad(res, 409, DUP_TRX, "TRXID_USED");
        manualPayment = { method: t.payNowVia.method, senderNumber, trxId, amount: t.payNow };
    }

    const orderNumber = await makeOrderNumber();
    const { token, hash } = newGuestToken();
    const now = new Date();
    const doc = {
        orderNumber,
        orderItems: t.items.map((l) => ({
            product: l.productId,
            slug: l.slug,
            name: l.name,
            nameBn: l.nameBn,
            image: l.image,
            variant: { options: l.options },
            note: l.note,
            quantity: l.quantity,
            units: l.units,
            price: l.unitPrice,
            comparePrice: l.comparePrice,
            freeShipping: l.freeShipping,
            lineTotal: l.lineTotal,
        })),
        shippingAddress: {
            name: String(b.name).trim(),
            phone,
            addressLine1: String(b.address).trim(),
            locationType: t.zone.key,
            locationLabel: t.zone.label,
        },
        customerNote: String(b.note || "").trim(),
        paymentMethod: t.paymentMethod,
        payNowVia: t.payNowVia || undefined,
        itemsPrice: t.itemsPrice,
        shippingPrice: t.shippingPrice,
        totalPrice: t.totalPrice,
        savings: t.savings,
        freeShippingApplied: t.freeShippingApplied,
        payNow: t.payNow,
        payOnDelivery: t.payOnDelivery,
        paymentStatus: manualPayment ? "Verifying" : "Pending",
        manualPayment,
        gatewayPayment: t.payNowVia?.flow === "gateway" ? { provider: t.payNowVia.provider, attempts: 0 } : undefined,
        // System entry: no updatedBy (never the string "system").
        statusHistory: [{ status: "Pending", updatedAt: now }],
        guestAccessTokenHash: hash,
        clientRequestId: b.clientRequestId || undefined,
    };

    // STOCK_DEDUCT_ON=placed: take the jars before saving; give them back if
    // the save fails. (Default "confirmed" deducts in the dashboard.)
    let taken = null;
    if (env.stockDeductOn === "placed") {
        const units = new Map();
        for (const it of doc.orderItems) units.set(String(it.product), (units.get(String(it.product)) || 0) + it.units);
        const r = await takeUnits(units, { reason: "order", orderNumber });
        if (!r.ok) return bad(res, 409, "দুঃখিত, এই পরিমাণ স্টকে নেই। পরিমাণ কমিয়ে চেষ্টা করুন অথবা ফোন করুন।", "OUT_OF_STOCK");
        taken = units;
        doc.stockDeducted = true;
    }

    let order;
    try {
        order = await Order.create(doc);
    } catch (err) {
        if (taken) await returnUnits(taken, { reason: "order_cancelled", orderNumber, note: "order was not saved" });
        if (err.code === 11000 && err.keyPattern?.["manualPayment.trxId"]) return bad(res, 409, DUP_TRX, "TRXID_USED");
        if (err.code === 11000 && err.keyPattern?.clientRequestId) {
            const replay = await replayOrder(b.clientRequestId);
            if (replay) return res.status(200).json(replay);
        }
        throw err;
    }

    recordNewOrder(order);
    notifyNewOrder(order);

    const nextAction = await nextActionFor(order);
    const fresh = nextAction ? await Order.findById(order._id).lean() : order.toObject();
    res.status(201).json({ success: true, orderNumber, guestAccessToken: token, order: toPublicOrder(fresh), nextAction });
};

const replayOrder = async (clientRequestId) => {
    const existing = await Order.findOne({ clientRequestId }).lean();
    if (!existing) return null;
    // The first response (and its token) never reached the browser; rotate.
    const { token, hash } = newGuestToken();
    await Order.updateOne({ _id: existing._id }, { $set: { guestAccessTokenHash: hash } });
    return {
        success: true,
        replayed: true,
        orderNumber: existing.orderNumber,
        guestAccessToken: token,
        order: toPublicOrder(existing),
        nextAction: canStartGateway(existing) ? { type: "retry_payment" } : null,
    };
};

// Loads the order named in the URL if the X-Order-Token matches. Unknown
// order and wrong token answer the same 404, so order numbers (which are
// sequential and guessable) cannot be probed.
const ownedOrder = async (req) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber }).select("+guestAccessTokenHash");
    if (!order || !tokenMatches(req.get("X-Order-Token"), order.guestAccessTokenHash)) return null;
    return order;
};
const notFound = (res) => bad(res, 404, "অর্ডারটি খুঁজে পাওয়া যায়নি।");

// GET /api/orders/:orderNumber   header X-Order-Token
export const getMyOrder = async (req, res) => {
    const order = await ownedOrder(req);
    res.set("Cache-Control", "no-store");
    if (!order) return notFound(res);
    res.json({ success: true, order: toPublicOrder(order.toObject()) });
};

// POST /api/orders/:orderNumber/pay   header X-Order-Token
// New gateway session for an unpaid gateway order (first try failed, tab
// closed). 200 { success, nextAction: { type: "redirect", url } }
export const retryPayment = async (req, res) => {
    const order = await ownedOrder(req);
    res.set("Cache-Control", "no-store");
    if (!order) return notFound(res);
    if (!canStartGateway(order)) return bad(res, 409, "এই অর্ডারে এখন অনলাইনে পেমেন্ট করার কিছু নেই।", "NOTHING_TO_PAY");
    try {
        const { redirectUrl } = await startGatewayPayment(order);
        res.json({ success: true, nextAction: { type: "redirect", url: redirectUrl } });
    } catch (err) {
        console.error(`Gateway retry failed for ${order.orderNumber}:`, err.message);
        bad(res, err.status === 503 ? 503 : 502, "পেমেন্ট পেজ খোলা যায়নি। একটু পরে আবার চেষ্টা করুন।", "GATEWAY_ERROR");
    }
};

// POST /api/orders/:orderNumber/payment   header X-Order-Token
// Body { trxId, senderNumber }. Only after the shop rejected the previous
// TrxID (paymentStatus "Failed"); the old one is kept in manualPayment.previous.
export const resubmitTrxId = async (req, res) => {
    const order = await ownedOrder(req);
    res.set("Cache-Control", "no-store");
    if (!order) return notFound(res);
    if (order.payNowVia?.flow !== "manual" || order.paymentStatus !== "Failed" || order.orderStatus === "Cancelled") {
        return bad(res, 409, "এই অর্ডারে নতুন TrxID দেওয়ার প্রয়োজন নেই।", "NOT_REJECTED");
    }
    const trxId = String(req.body.trxId).trim().toUpperCase();
    const senderNumber = normalizeBdPhone(req.body.senderNumber);
    if (await Order.exists({ "manualPayment.trxId": trxId, _id: { $ne: order._id } })) return bad(res, 409, DUP_TRX, "TRXID_USED");

    const prev = order.manualPayment;
    try {
        const updated = await Order.findOneAndUpdate(
            { _id: order._id, paymentStatus: "Failed" },
            {
                $set: {
                    paymentStatus: "Verifying",
                    "manualPayment.trxId": trxId,
                    "manualPayment.senderNumber": senderNumber,
                    "manualPayment.submittedAt": new Date(),
                },
                $unset: { "manualPayment.rejectedAt": 1, "manualPayment.rejectReason": 1 },
                $push: {
                    "manualPayment.previous": {
                        trxId: prev.trxId,
                        senderNumber: prev.senderNumber,
                        rejectedAt: prev.rejectedAt,
                        rejectReason: prev.rejectReason,
                    },
                },
            },
            { new: true },
        ).lean();
        if (!updated) return bad(res, 409, "এই অর্ডারে নতুন TrxID দেওয়ার প্রয়োজন নেই।", "NOT_REJECTED");
        notifyPaymentSubmitted(updated);
        res.json({ success: true, order: toPublicOrder(updated) });
    } catch (err) {
        if (err.code === 11000) return bad(res, 409, DUP_TRX, "TRXID_USED");
        throw err;
    }
};
