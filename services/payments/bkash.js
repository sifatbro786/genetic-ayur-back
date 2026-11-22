// services/payments/bkash.js
// bKash Tokenized Checkout (PGW v1.2.0-beta), "0011" = checkout without
// agreement (one-off payment). Flow:
//   create  -> bkashURL (shopper pays inside bKash)
//   bKash redirects the browser to our callbackURL ?paymentID&status
//   execute -> transactionStatus "Completed" + trxID; on a timeout or an
//              unclear answer, query payment/status before giving up
// Sandbox by default (BKASH_BASE_URL). Live base URL comes with the live keys.
import env from "../../config/env.js";
import { GatewayError, requestJson } from "./http.js";

let cached = null; // { idToken, refreshToken, expiresAt }
export const resetBkashToken = () => {
    cached = null;
};

const post = (path, body, headers) =>
    requestJson(
        `${env.bkash.baseUrl}${path}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
            body: JSON.stringify(body),
        },
        "bKash",
    );

// id_token lives an hour. Granting on every call is rate limited by bKash, so
// it is cached per process and refreshed a minute early.
const idToken = async () => {
    if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.idToken;
    const creds = { username: env.bkash.username, password: env.bkash.password };
    const keys = { app_key: env.bkash.appKey, app_secret: env.bkash.appSecret };
    let data;
    if (cached?.refreshToken) {
        data = await post("/tokenized/checkout/token/refresh", { ...keys, refresh_token: cached.refreshToken }, creds).catch(() => null);
    }
    if (!data?.id_token) data = await post("/tokenized/checkout/token/grant", keys, creds);
    if (!data?.id_token) throw new GatewayError(`bKash token grant failed: ${data?.statusMessage || data?.msg || "no token"}`);
    cached = {
        idToken: data.id_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    return cached.idToken;
};

const authed = async (path, body) => post(path, body, { Authorization: await idToken(), "X-APP-Key": env.bkash.appKey });

/** @returns {Promise<{sessionId: string, redirectUrl: string}>} */
export const createPayment = async ({ amount, invoice, payerReference, callbackURL }) => {
    const data = await authed("/tokenized/checkout/create", {
        mode: "0011",
        payerReference: payerReference || invoice,
        callbackURL,
        amount: Number(amount).toFixed(2),
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: invoice,
    });
    if (data.statusCode !== "0000" || !data.paymentID || !data.bkashURL) {
        throw new GatewayError(`bKash create failed: ${data.statusCode || ""} ${data.statusMessage || ""}`.trim());
    }
    return { sessionId: data.paymentID, redirectUrl: data.bkashURL };
};

const toResult = (data) => ({
    completed: data?.transactionStatus === "Completed",
    status: data?.transactionStatus || data?.statusMessage || "unknown",
    trxId: data?.trxID,
    amount: Number(data?.amount),
    invoice: data?.merchantInvoiceNumber,
    sessionId: data?.paymentID,
});

export const queryPayment = async (paymentID) => toResult(await authed("/tokenized/checkout/payment/status", { paymentID }));

// Execute is the step that actually moves the money. If it times out or
// answers with an error (for example "already completed" on a retried
// callback), the status query tells the truth.
export const executePayment = async (paymentID) => {
    try {
        const r = toResult(await authed("/tokenized/checkout/execute", { paymentID }));
        if (r.completed) return r;
    } catch (err) {
        if (!(err instanceof GatewayError)) throw err;
    }
    return queryPayment(paymentID);
};
