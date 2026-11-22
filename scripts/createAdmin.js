// scripts/createAdmin.js
// Creates a dashboard account, or resets the password of an existing one
// (which also signs that account out everywhere).
//
//   npm run admin:create -- owner@example.com "a long password" "Owner name"
//
// Or set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env and run it without
// arguments; remove ADMIN_PASSWORD from .env afterwards.
import mongoose from "mongoose";
import { assertEnv } from "../config/env.js";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";

assertEnv();
const [, , argEmail, argPassword, argName] = process.argv;
const email = (argEmail || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = argPassword || process.env.ADMIN_PASSWORD || "";
const name = argName || process.env.ADMIN_NAME || "";

if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || password.length > 72) {
    console.error('Usage: npm run admin:create -- <email> "<password, 10 to 72 chars>" ["Name"]');
    process.exit(1);
}

await connectDB();
try {
    const existing = await User.findOne({ email });
    if (existing) {
        existing.password = password;
        existing.isActive = true;
        if (name) existing.name = name;
        await existing.save();
        console.log(`Password reset for ${email}. Other sessions of this account are signed out.`);
    } else {
        await User.create({ email, password, name });
        console.log(`Admin ${email} created.`);
    }
} catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
} finally {
    await mongoose.connection.close();
}
