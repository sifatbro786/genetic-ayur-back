import mongoose from "mongoose";
import env from "./env.js";

// Unknown fields in a query filter are dropped instead of matching everything
// with an empty filter. Pinned so a Mongoose upgrade cannot change it.
mongoose.set("strictQuery", true);

export const connectDB = async (uri = env.mongoUri) => {
    await mongoose.connect(uri, {
        // Fail fast at boot if the cluster is unreachable (wrong URI, Atlas IP
        // allowlist) instead of hanging on the default 30 s.
        serverSelectionTimeoutMS: 10_000,
    });
    console.log(`MongoDB connected: ${mongoose.connection.name}`);
};

export const disconnectDB = () => mongoose.connection.close();
