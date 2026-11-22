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
};

export const envProblems = () => {
    const problems = [];
    if (!env.mongoUri) problems.push("MONGODB_URI is not set");
    if (env.jwtSecret.length < 32) problems.push("JWT_SECRET must be at least 32 characters");
    if (isProd && env.clientUrls.length === 0) problems.push("CLIENT_URL is required in production");
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
