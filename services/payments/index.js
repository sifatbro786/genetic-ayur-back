// services/payments/index.js
// Gateway orchestration. Controllers call these; provider modules only talk
// HTTP. Rules:
//   - An order is marked paid only from a gateway answer this server fetched
//     itself (execute/query for bKash, validation API for SSLCommerz), never
//     from what a browser redirect or an IPN body claims.
//   - The verified amount must equal order.payNow and the currency BDT.
//   - Marking paid is one conditional update, so a callback and an IPN
//     arriving together record the payment once.
//   - A gateway failure leaves the order "Pending" with lastError: anyone can
//     POST a fake "fail" to a public callback URL, so failures change nothing
//     that matters; the shopper can simply try again.
import env, { bkashConfigured, sslcommerzConfigured } from "../../config/env.js";
import Order from "../../models/Order.js";
import SiteSettings from "../../models/SiteSettings.js";
import { notifyPaymentReceived } from "../mailer.js";
import * as bkash from "./bkash.js";
import { GatewayError } from "./http.js";
import * as ssl from "./sslcommerz.js";

export { GatewayError };

export const gatewayStatus = () => ({ bkash: bkashConfigured(), sslcommerz: sslcommerzConfigured() });

const configured = (provider) => (provider === "bkash" ? bkashConfigured() : sslcommerzConfigured());

const callbackUrls = () => {
    const api = `${env.apiPublicUrl}/api/payments`;
    return {
        bkash: `${api}/bkash/callback`,
        ssl: { success: `${api}/sslcommerz/success`, fail: `${api}/sslcommerz/fail`, cancel: `${api}/sslcommerz/cancel`, ipn: `${api}/sslcommerz/ipn` },
    };
};

/** Where the shopper's browser goes after the gateway. No token in the URL:
 *  the storefront saved it before redirecting (Footpath rule). */
export const storefrontReturnUrl = (orderNumber, result) =>
    orderNumber
        ? `${env.storefrontUrl}/order/${encodeURIComponent(orderNumber)}?payment=${result}`
        : `${env.storefrontUrl}/?payment=${result}`;

export const canStartGateway = (order) =>
    order.payNow > 0 &&
    order.payNowVia?.flow === "gateway" &&
    order.orderStatus !== "Cancelled" &&
    ["Pending", "Failed"].includes(order.paymentStatus);

/**
 * Opens a new gateway session for an order (first try or a retry).
 * @returns {Promise<{redirectUrl: string}>}
 */
export const startGatewayPayment = async (order) => {
    const provider = order.payNowVia.provider;
    if (!canStartGateway(order)) throw new GatewayError("This order has nothing to pay online", { status: 409 });
    if (!configured(provider)) throw new GatewayError("Online payment is switched off right now", { status: 503 });

    // Reserve the attempt number first; the tran_id must be unique per try.
    const updated = await Order.findOneAndUpdate(
        { _id: order._id },
        { $inc: { "gatewayPayment.attempts": 1 }, $set: { "gatewayPayment.provider": provider } },
        { new: true },
    );
    const attempt = updated.gatewayPayment.attempts;
    const urls = callbackUrls();

    let session;
    if (provider === "bkash") {
        session = await bkash.createPayment({
            amount: order.payNow,
            invoice: order.orderNumber,
            payerReference: order.shippingAddress.phone,
            callbackURL: urls.bkash,
        });
    } else {
        const site = await SiteSettings.getMain().select("email").lean();
        session = await ssl.initPayment({
            tranId: `${order.orderNumber}-${attempt}`,
            amount: order.payNow,
            order,
            urls: urls.ssl,
            email: site?.email || env.smtp.user || "orders@example.com",
        });
    }

    await Order.updateOne(
        { _id: order._id },
        { $set: { "gatewayPayment.sessionId": session.sessionId, "gatewayPayment.amount": order.payNow, paymentStatus: "Pending" } },
    );
    return { redirectUrl: session.redirectUrl };
};

const fromSession = (provider, sessionId) => {
    // SSLCommerz tran_id is "<orderNumber>-<attempt>", so an older attempt
    // paid in a second tab still finds its order.
    if (provider === "sslcommerz") return Order.findOne({ orderNumber: String(sessionId).split("-")[0] });
    return Order.findOne({ "gatewayPayment.provider": "bkash", "gatewayPayment.sessionId": sessionId });
};

const noteFailure = (order, reason) =>
    Order.updateOne(
        { _id: order._id, paymentStatus: { $in: ["Pending", "Failed"] } },
        { $set: { "gatewayPayment.lastError": String(reason).slice(0, 200) } },
    );

/**
 * Records a verified gateway result against an order.
 * @returns {Promise<"paid"|"held"|"already"|"failed"|"mismatch">}
 */
export const applyGatewayResult = async (order, provider, r) => {
    if (!r.completed) {
        await noteFailure(order, `${provider}: ${r.status}`);
        return "failed";
    }
    if (Math.round(r.amount) !== order.payNow || (r.currency && r.currency !== "BDT")) {
        // Money arrived but not the amount asked: keep it out of "Paid" and
        // leave a trail for the shop to sort out with the shopper.
        await noteFailure(order, `${provider}: amount ${r.amount} ${r.currency || ""} does not match ${order.payNow} BDT (trx ${r.trxId})`);
        console.error(`Gateway amount mismatch on ${order.orderNumber}`);
        return "mismatch";
    }
    if (order.payNowVia?.provider !== provider) {
        await noteFailure(order, `${provider} payment for an order set to ${order.payNowVia?.provider}`);
        return "mismatch";
    }

    const now = new Date();
    // A risky card is recorded but held at "Verifying" for the shop to check.
    const paymentStatus = r.risky ? "Verifying" : order.payOnDelivery > 0 ? "Advance Paid" : "Paid";
    const set = {
        paymentStatus,
        amountPaid: order.payNow,
        "gatewayPayment.trxId": r.trxId,
        "gatewayPayment.valId": r.valId,
        "gatewayPayment.bankTranId": r.bankTranId,
        "gatewayPayment.cardType": r.cardType,
        "gatewayPayment.paidAt": now,
        "gatewayPayment.lastError": r.risky ? "Flagged risky by the gateway: verify before confirming" : undefined,
    };
    for (const k of Object.keys(set)) if (set[k] === undefined) delete set[k];

    let res;
    try {
        res = await Order.findOneAndUpdate(
            { _id: order._id, paymentStatus: { $in: ["Pending", "Failed"] } },
            { $set: set, ...(r.risky ? {} : { $unset: { "gatewayPayment.lastError": 1 } }) },
            { new: true },
        );
    } catch (err) {
        // Same gateway transaction already recorded on another order.
        if (err.code === 11000) return "already";
        throw err;
    }
    if (!res) {
        // Already paid. A second, different transaction means the shopper
        // paid twice (two tabs): flag it for a refund instead of losing it.
        const fresh = await Order.findById(order._id).lean();
        if (fresh?.gatewayPayment?.trxId && r.trxId && fresh.gatewayPayment.trxId !== r.trxId) {
            await Order.updateOne(
                { _id: order._id },
                { $set: { "gatewayPayment.lastError": `Second payment received (trx ${r.trxId}); refund it from the gateway panel` } },
            );
            console.error(`Duplicate gateway payment on ${order.orderNumber}`);
        }
        return "already";
    }
    if (!r.risky) notifyPaymentReceived(res);
    return r.risky ? "held" : "paid";
};

// ─── provider entry points used by the callback controller ───────────

/** bKash browser callback. @returns {{orderNumber?: string, result: string}} */
export const handleBkashCallback = async ({ paymentID, status }) => {
    if (!paymentID) return { result: "unknown" };
    let order = await fromSession("bkash", paymentID);
    if (status !== "success") {
        if (order) await noteFailure(order, `bkash: ${status || "no status"}`);
        return { orderNumber: order?.orderNumber, result: status === "cancel" ? "cancelled" : "failed" };
    }
    const r = await bkash.executePayment(paymentID);
    // An older attempt (the shopper retried, then finished the first bKash
    // tab) no longer matches sessionId; its invoice still names the order.
    // Executing is safe: bKash only executes this merchant's own payments.
    if (!order && r.invoice) order = await Order.findOne({ orderNumber: r.invoice });
    if (!order) {
        if (r.completed) console.error("bKash payment completed for an unknown order; check the bKash merchant panel");
        return { result: "unknown" };
    }
    if (r.invoice && r.invoice !== order.orderNumber) {
        await noteFailure(order, "bkash: invoice number does not match");
        return { orderNumber: order.orderNumber, result: "failed" };
    }
    const outcome = await applyGatewayResult(order, "bkash", r);
    return { orderNumber: order.orderNumber, result: outcome === "paid" || outcome === "already" ? "success" : outcome === "held" ? "review" : "failed" };
};

/** SSLCommerz success/IPN: validate val_id with SSLCommerz, then apply. */
export const handleSslValidation = async ({ valId, tranId }) => {
    if (!valId) return { result: "failed" };
    const r = await ssl.validate(valId);
    // The validated tran_id decides the order; the posted one is a hint only.
    if (tranId && r.sessionId && r.sessionId !== tranId) return { result: "failed" };
    const order = r.sessionId ? await fromSession("sslcommerz", r.sessionId) : null;
    if (!order) return { result: "unknown" };
    const outcome = await applyGatewayResult(order, "sslcommerz", r);
    return { orderNumber: order.orderNumber, result: outcome === "paid" || outcome === "already" ? "success" : outcome === "held" ? "review" : "failed" };
};

export const orderNumberFromTranId = (tranId) => (tranId ? String(tranId).split("-")[0] : undefined);

/** Dashboard "re-check": asks the gateway directly (missed IPN, closed tab). */
export const recheckGatewayPayment = async (order) => {
    const g = order.gatewayPayment;
    if (!g?.sessionId) throw new GatewayError("No online payment was started for this order", { status: 409 });
    if (!configured(g.provider)) throw new GatewayError("Gateway keys are not configured", { status: 503 });
    const r = g.provider === "bkash" ? await bkash.queryPayment(g.sessionId) : await ssl.queryByTranId(g.sessionId);
    return { outcome: await applyGatewayResult(order, g.provider, r), status: r.status };
};
