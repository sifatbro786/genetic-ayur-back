// app.js — the Express app, without listen() or the DB connection, so tests
// can mount it against an in-memory MongoDB.
import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import hpp from "hpp";
import morgan from "morgan";
import mongoose from "mongoose";
import env from "./config/env.js";
import { errorHandler, notFound } from "./middlewares/error.js";
import { globalApiLimiter } from "./middlewares/rateLimiter.js";
import { sanitizeRequest } from "./middlewares/sanitize.js";
import adminAuthRoutes from "./routes/admin/authRoutes.js";
import { customerRouter as adminCustomerRoutes, orderRouter as adminOrderRoutes } from "./routes/admin/orderRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import storefrontRoutes from "./routes/storefrontRoutes.js";

const app = express();

app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", env.trustProxy);

// ═══ Middleware order is load-bearing (same as the Footpath base) ═══
//   compression → helmet → [gateway callbacks] → cors → body parsers → sanitize → hpp → limiter → routes
// sanitize MUST precede hpp: it makes Express 5's req.query writable.

app.use(compression());
app.use(helmet());

// Gateway callbacks come from bKash/SSLCommerz pages and servers, not from
// the storefront, so they sit before CORS with their own parser, sanitizer
// and limiter (routes/paymentRoutes.js).
app.use("/api/payments", paymentRoutes);

const allowed = new Set([...env.clientUrls, ...(env.isProd ? [] : ["http://localhost:3000"])]);
app.use(
    cors({
        origin(origin, cb) {
            // No Origin header = not a cross-origin browser request (Next.js
            // server rendering, curl, uptime checks). CORS cannot protect those
            // anyway, so they pass without CORS headers instead of failing; a
            // browser on another site always sends Origin and is checked here.
            if (!origin) return cb(null, false);
            if (allowed.has(origin)) return cb(null, true);
            const err = new Error("Origin not allowed");
            err.status = 403;
            return cb(err);
        },
        // X-Order-Token: the guest order token, sent as a header so it never
        // lands in URLs, server logs or browser history.
        allowedHeaders: ["Content-Type", "Authorization", "X-Order-Token"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        maxAge: 600,
    }),
);

// Landing page copy in Bangla is a few KB; images go through multipart
// upload (Phase 3), never JSON. 1 MB leaves room without inviting abuse.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(sanitizeRequest);
app.use(hpp());

if (env.nodeEnv === "development") app.use(morgan("dev"));

app.get("/health", (_req, res) => {
    const db = mongoose.connection.readyState === 1;
    res.status(db ? 200 : 503).json({ success: db, status: db ? "ok" : "db_down" });
});

app.use("/api", globalApiLimiter);
app.use("/api", storefrontRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/admin/customers", adminCustomerRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
