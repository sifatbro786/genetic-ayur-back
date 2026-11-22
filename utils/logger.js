// utils/logger.js (from the Footpath base)
// debug(...) prints only with LOG_LEVEL=debug and masks personal fields, so
// customer names, phones, addresses and bKash/Nagad references never land in
// server logs or whatever ships them.
const DEBUG = process.env.LOG_LEVEL === "debug";
const PII =
    /^(name|email|phone|address|addressLine1|senderNumber|trxId|password|token|guestAccessToken|authorization)$/i;

export const redact = (value, depth = 0) => {
    if (value === null || typeof value !== "object" || depth > 5) return value;
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = PII.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
};

export const debug = (...args) => {
    if (!DEBUG) return;
    console.log(...args.map((a) => (typeof a === "object" ? redact(a) : a)));
};
