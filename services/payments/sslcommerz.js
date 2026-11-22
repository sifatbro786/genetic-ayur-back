// services/payments/sslcommerz.js
// SSLCommerz hosted checkout (v4): cards, bKash, Nagad, Rocket, net banking.
//   init         -> GatewayPageURL
//   success/fail/cancel are browser form POSTs (not trusted); IPN is a server
//   POST (not trusted either). Every one of them is only a hint: the payment
//   is accepted only after the validation API confirms val_id, amount,
//   currency and tran_id.
import env from "../../config/env.js";
import { GatewayError, requestJson } from "./http.js";

const base = () => (env.sslcommerz.sandbox ? "https://sandbox.sslcommerz.com" : "https://securepay.sslcommerz.com");
const creds = () => ({ store_id: env.sslcommerz.storeId, store_passwd: env.sslcommerz.storePassword });

/** @returns {Promise<{sessionId: string, redirectUrl: string}>} */
export const initPayment = async ({ tranId, amount, order, urls, email }) => {
    const a = order.shippingAddress;
    const form = new URLSearchParams({
        ...creds(),
        total_amount: Number(amount).toFixed(2),
        currency: "BDT",
        tran_id: tranId,
        success_url: urls.success,
        fail_url: urls.fail,
        cancel_url: urls.cancel,
        ipn_url: urls.ipn,
        cus_name: a.name,
        // SSLCommerz requires an email; shoppers here give none.
        cus_email: email,
        cus_add1: a.addressLine1.slice(0, 50),
        cus_city: a.locationLabel || "Bangladesh",
        cus_country: "Bangladesh",
        cus_phone: a.phone,
        shipping_method: "NO",
        num_of_item: String(order.orderItems.reduce((s, i) => s + i.quantity, 0)),
        product_name: order.orderItems.map((i) => i.name).join(", ").slice(0, 255),
        product_category: "General",
        product_profile: "physical-goods",
        value_a: order.orderNumber,
    });
    const data = await requestJson(
        `${base()}/gwprocess/v4/api.php`,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form },
        "SSLCommerz",
    );
    if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
        throw new GatewayError(`SSLCommerz init failed: ${String(data.failedreason || data.status || "").slice(0, 120)}`);
    }
    return { sessionId: tranId, redirectUrl: data.GatewayPageURL };
};

const toResult = (d) => ({
    completed: d?.status === "VALID" || d?.status === "VALIDATED",
    status: d?.status || "unknown",
    sessionId: d?.tran_id,
    valId: d?.val_id,
    amount: Number(d?.amount),
    currency: d?.currency,
    trxId: d?.bank_tran_id,
    bankTranId: d?.bank_tran_id,
    cardType: d?.card_type,
    // "1" = SSLCommerz flags the card as risky: hold for a manual check.
    risky: String(d?.risk_level) === "1",
});

export const validate = async (valId) => {
    const q = new URLSearchParams({ val_id: valId, ...creds(), v: "1", format: "json" });
    return toResult(await requestJson(`${base()}/validator/api/validationserverAPI.php?${q}`, {}, "SSLCommerz"));
};

/** Look up by tran_id: used when an IPN was missed (dashboard "re-check"). */
export const queryByTranId = async (tranId) => {
    const q = new URLSearchParams({ tran_id: tranId, ...creds(), format: "json" });
    const d = await requestJson(`${base()}/validator/api/merchantTransIDvalidationAPI.php?${q}`, {}, "SSLCommerz");
    const hit = (d?.element || []).find((e) => e.status === "VALID" || e.status === "VALIDATED");
    return hit ? toResult(hit) : { completed: false, status: d?.element?.[0]?.status || "NOT_FOUND", sessionId: tranId };
};
