// services/payments/http.js
// One fetch wrapper for the gateways: timeout, JSON parsing, and a seam the
// tests replace (setGatewayFetch) so no test ever calls bKash or SSLCommerz.
export class GatewayError extends Error {
    constructor(message, { status = 502 } = {}) {
        super(message);
        this.name = "GatewayError";
        this.status = status;
    }
}

let impl = (...args) => globalThis.fetch(...args);
export const setGatewayFetch = (fn) => {
    impl = fn || ((...args) => globalThis.fetch(...args));
};

export const requestJson = async (url, init = {}, label = "gateway") => {
    let res;
    try {
        res = await impl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
        throw new GatewayError(`${label} unreachable (${err.name})`);
    }
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new GatewayError(`${label} returned a non JSON answer (HTTP ${res.status})`);
    }
};
