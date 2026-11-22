// services/orderNumber.js
// GA + YYMMDD (Dhaka date) + daily sequence: GA261122001. Readable on a phone
// call, sortable, and never reused (atomic counter, not countDocuments).
import crypto from "node:crypto";
import { nextSeq } from "../models/Counter.js";

// Dhaka has no DST, so a fixed +6 h offset gives the local calendar date. The
// server clock is UTC on the VPS; without this, orders placed between
// midnight and 6 am Dhaka time would carry yesterday's date.
const dhakaDate = (now = new Date()) => {
    const d = new Date(now.getTime() + 6 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};

export const makeOrderNumber = async (now = new Date()) => {
    const date = dhakaDate(now);
    const seq = await nextSeq(`order-${date}`);
    return `GA${date}${String(seq).padStart(3, "0")}`;
};

export const ORDER_NUMBER_RE = /^GA\d{9,12}$/;

// Guest access token: 24 random bytes (48 hex). Only its SHA-256 is stored.
export const newGuestToken = () => {
    const token = crypto.randomBytes(24).toString("hex");
    return { token, hash: hashToken(token) };
};

export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** Constant time comparison of a presented token against the stored hash. */
export const tokenMatches = (token, storedHash) => {
    if (!token || !storedHash || !/^[a-f0-9]{48}$/.test(String(token))) return false;
    const a = Buffer.from(hashToken(token), "hex");
    const b = Buffer.from(String(storedHash), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};
