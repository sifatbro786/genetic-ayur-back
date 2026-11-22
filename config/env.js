// config/env.js
// Reads and checks the environment once, at boot. A missing MONGODB_URI or a
// short JWT_SECRET should stop the process immediately, not surface later as
// a 500 on the first login or the first order.
import "dotenv/config";

const isProd = process.env.NODE_ENV === "production";

const list = (v) =>
    (v || "")
        .split(",")
        .map((s) => s.trim().replace(/\/$/, ""))
        .filter(Boolean);

const env = {
    isProd,
    isTest: process.env.NODE_ENV === "test",
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT) || 5000,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || "",
    jwtSecret: process.env.JWT_SECRET || "",
    jwtExpire: process.env.JWT_EXPIRE || "1d",
    // Browser origins allowed by CORS: the storefront (Vercel preview and
    // production domains). Comma separated, no trailing slash needed.
    clientUrls: list(process.env.CLIENT_URL),
    // Reverse proxy hops in front of Node (nginx = 1). The rate limiters key on
    // req.ip, which is the visitor only when this matches the real setup. Too
    // high lets a visitor spoof X-Forwarded-For and dodge every limit.
    trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : isProd ? 1 : 0,

    // Where shoppers land after a gateway (order status page). Defaults to the
    // first CLIENT_URL. Separate because CLIENT_URL may list preview domains.
    storefrontUrl: (process.env.STOREFRONT_URL || list(process.env.CLIENT_URL)[0] || "http://localhost:3000").replace(/\/$/, ""),
    // Public base URL of THIS API, as the gateways must call it back
    // (https://api.example.com). Gateways cannot reach localhost.
    apiPublicUrl: (process.env.API_PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 5000}`).replace(/\/$/, ""),

    // "confirmed" (default): stock is checked when the order is placed but
    // deducted when the shop confirms it, so fake COD orders never lock jars.
    // "placed": deducted the moment the order is saved.
    // Storefront on-demand revalidation (Next.js route handler + shared secret).
    revalidate: {
        url: process.env.REVALIDATE_URL || "",
        secret: process.env.REVALIDATE_SECRET || "",
    },

    // Uploaded images: folder on the VPS disk, served at /uploads.
    uploadDir: process.env.UPLOAD_DIR || "uploads",

    stockDeductOn: process.env.STOCK_DEDUCT_ON === "placed" ? "placed" : "confirmed",

    smtp: {
        host: process.env.SMTP_HOST || "",
        port: Number(process.env.SMTP_PORT) || 465,
        secure: process.env.SMTP_SECURE !== "false",
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
        from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
        notifyTo: list(process.env.ORDER_NOTIFY_TO),
    },

    // bKash Tokenized Checkout. All four credentials come from bKash after
    // merchant onboarding. Empty = the gateway is off and bKash falls back to
    // manual Send Money + TrxID (if the dashboard has a number).
    bkash: {
        baseUrl: (process.env.BKASH_BASE_URL || "https://tokenized.sandbox.bka.sh/v1.2.0-beta").replace(/\/$/, ""),
        appKey: process.env.BKASH_APP_KEY || "",
        appSecret: process.env.BKASH_APP_SECRET || "",
        username: process.env.BKASH_USERNAME || "",
        password: process.env.BKASH_PASSWORD || "",
    },

    // SSLCommerz: cards, bKash, Nagad, Rocket and internet banking in one page.
    sslcommerz: {
        storeId: process.env.SSLCZ_STORE_ID || "",
        storePassword: process.env.SSLCZ_STORE_PASSWORD || "",
        sandbox: process.env.SSLCZ_SANDBOX !== "false",
    },
};

export const bkashConfigured = () =>
    Boolean(env.bkash.appKey && env.bkash.appSecret && env.bkash.username && env.bkash.password);
export const sslcommerzConfigured = () => Boolean(env.sslcommerz.storeId && env.sslcommerz.storePassword);
export const mailConfigured = () => Boolean(env.smtp.host && env.smtp.user && env.smtp.pass && env.smtp.notifyTo.length);

export const envProblems = () => {
    const problems = [];
    if (!env.mongoUri) problems.push("MONGODB_URI is not set");
    if (env.jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters");
    if (isProd && env.clientUrls.length === 0) problems.push("CLIENT_URL is required in production");
    // A gateway turned on with a localhost callback would take the money and
    // then never be able to tell us about it.
    if (isProd && (bkashConfigured() || sslcommerzConfigured()) && !/^https:\/\//.test(env.apiPublicUrl)) {
        problems.push("API_PUBLIC_URL must be the public https URL of this API when a payment gateway is configured");
    }
    if (env.revalidate.url && env.revalidate.secret.length < 24) problems.push("REVALIDATE_SECRET must be at least 24 characters when REVALIDATE_URL is set");
    if (isProd && env.sslcommerz.sandbox && sslcommerzConfigured()) {
        console.warn("SSLCZ_SANDBOX is on in production: payments go to the SSLCommerz sandbox.");
    }
    if (isProd && /sandbox/.test(env.bkash.baseUrl) && bkashConfigured()) {
        console.warn("BKASH_BASE_URL points at the bKash sandbox in production.");
    }
    return problems;
};

export const assertEnv = () => {
    const problems = envProblems();
    if (problems.length) {
        console.error("Environment is not ready:\n  - " + problems.join("\n  - "));
        console.error("Copy .env.example to .env and fill it in.");
        process.exit(1);
    }
};

export default env;
