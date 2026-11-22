// middlewares/auth.js
// Bearer JWT for the dashboard. The storefront is fully public and never
// sends a token.
import jwt from "jsonwebtoken";
import env from "../config/env.js";
import User from "../models/User.js";

const deny = (res, message = "Not authorized") => res.status(401).json({ success: false, message });

export const signToken = (user) =>
    jwt.sign({ sub: String(user._id), v: user.tokenVersion }, env.jwtSecret, {
        expiresIn: env.jwtExpire,
        algorithm: "HS256",
    });

export const protect = async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) return deny(res, "Not authorized, no token");

    let payload;
    try {
        // Algorithm pinned: never let the token header choose (alg "none" etc.).
        payload = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    } catch {
        return deny(res, "Session expired, please log in again");
    }

    const user = await User.findById(payload.sub);
    // Deactivated account, deleted account or password changed since issue.
    if (!user || !user.isActive || user.tokenVersion !== payload.v) return deny(res, "Session expired, please log in again");

    req.user = user;
    return next();
};

export const admin = (req, res, next) =>
    req.user?.role === "admin" ? next() : res.status(403).json({ success: false, message: "Admin access only" });

export const adminProtect = [protect, admin];
