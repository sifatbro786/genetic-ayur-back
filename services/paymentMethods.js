// services/paymentMethods.js
// Pure: which payment methods can the storefront offer right now, and how is
// each one collected. Settings say what the owner turned on; `gateways` says
// which gateway keys exist in .env. A method whose gateway has no keys is
// hidden, so the shop never takes an order that nobody can pay.
//
// flow:
//   cod     : cash to the courier
//   manual  : shopper sends money to the shop's number, types the TrxID,
//             shop verifies in the dashboard
//   gateway : shopper is redirected to bKash / SSLCommerz; the API confirms
//             the payment server to server before marking it paid

/**
 * @param {object} payment  SiteSettings.payment
 * @param {{bkash?: boolean, sslcommerz?: boolean}} gateways
 * @returns {{method: string, flow: "cod"|"manual"|"gateway", provider?: string}[]}
 */
export const resolveMethods = (payment = {}, gateways = {}) => {
    const out = [];
    if (payment.cod?.enabled) out.push({ method: "COD", flow: "cod" });
    const b = payment.bkash;
    if (b?.enabled) {
        if (b.mode === "gateway") {
            if (gateways.bkash) out.push({ method: "bKash", flow: "gateway", provider: "bkash" });
        } else out.push({ method: "bKash", flow: "manual" });
    }
    if (payment.nagad?.enabled && payment.nagad.mode !== "gateway") out.push({ method: "Nagad", flow: "manual" });
    if (payment.online?.enabled && gateways.sslcommerz) out.push({ method: "Online", flow: "gateway", provider: "sslcommerz" });
    return out;
};
