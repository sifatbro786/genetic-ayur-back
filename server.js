// server.js — boot: check env, connect, listen, shut down cleanly.
import env, { assertEnv } from "./config/env.js";
import { connectDB, disconnectDB } from "./config/db.js";

assertEnv();

const { default: app } = await import("./app.js");

try {
    await connectDB();
} catch (err) {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
}

const server = app.listen(env.port, () => {
    console.log(`Genetic Ayur API on http://localhost:${env.port} (${env.nodeEnv})`);
});

// pm2 reload / docker stop send SIGTERM: finish in-flight requests (an order
// being saved) before closing the DB connection.
const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
        await disconnectDB().catch(() => {});
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
