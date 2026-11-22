// controllers/paymentController.js — gateway callbacks and IPN.
// These URLs are public and reachable by anyone, so nothing they receive is
// believed: each handler asks the gateway itself (services/payments). The
// browser endings always redirect to the storefront order page; errors there
// become "?payment=failed" plus a server log, never a raw JSON page.
import {
    handleBkashCallback,
    handleSslValidation,
    orderNumberFromTranId,
    storefrontReturnUrl,
} from "../services/payments/index.js";

const go = (res, orderNumber, result) => res.redirect(303, storefrontReturnUrl(orderNumber, result));

const safe = async (label, fn, onError) => {
    try {
        return await fn();
    } catch (err) {
        console.error(`${label} failed:`, err.message);
        return onError;
    }
};

// GET /api/payments/bkash/callback?paymentID&status=success|failure|cancel
export const bkashCallback = async (req, res) => {
    const paymentID = String(req.query.paymentID || "").slice(0, 100);
    const status = String(req.query.status || "").slice(0, 20);
    const out = await safe("bKash callback", () => handleBkashCallback({ paymentID, status }), { result: "failed" });
    go(res, out.orderNumber, out.result);
};

// POST /api/payments/sslcommerz/success  (browser form post from SSLCommerz)
export const sslSuccess = async (req, res) => {
    const tranId = String(req.body.tran_id || "").slice(0, 60);
    const valId = String(req.body.val_id || "").slice(0, 100);
    const out = await safe("SSLCommerz success", () => handleSslValidation({ valId, tranId }), { result: "failed" });
    go(res, out.orderNumber || orderNumberFromTranId(tranId), out.result);
};

// POST /api/payments/sslcommerz/fail | /cancel
// Not verified, so they change nothing: the order stays payable.
export const sslFail = (result) => (req, res) => go(res, orderNumberFromTranId(String(req.body.tran_id || "").slice(0, 60)), result);

// POST /api/payments/sslcommerz/ipn  (server to server)
// SSLCommerz retries an IPN that does not get a 200, so validation errors
// still answer 200 once logged; a gateway outage answers 502 to get a retry.
export const sslIpn = async (req, res) => {
    const valId = String(req.body.val_id || "").slice(0, 100);
    const tranId = String(req.body.tran_id || "").slice(0, 60);
    if (!valId) return res.status(200).json({ success: false });
    try {
        const out = await handleSslValidation({ valId, tranId });
        res.status(200).json({ success: out.result === "success" });
    } catch (err) {
        console.error("SSLCommerz IPN failed:", err.message);
        res.status(502).json({ success: false });
    }
};
