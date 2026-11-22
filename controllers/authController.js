// controllers/authController.js — dashboard login. No register route exists.
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { signToken } from "../middlewares/auth.js";

// Compared against when the email is unknown, so "no such user" and "wrong
// password" take the same time and give the same message (no email probing).
// Built once at boot with the same cost as real hashes.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-real-password", 12);

// POST /api/admin/auth/login  { email, password } -> { success, token, user }
export const login = async (req, res) => {
    const email = String(req.body.email).trim().toLowerCase();
    const user = await User.findOne({ email }).select("+password");
    const ok = user
        ? await user.matchPassword(req.body.password)
        : await bcrypt.compare(String(req.body.password), DUMMY_HASH);
    if (!user || !ok || !user.isActive) {
        return res.status(401).json({ success: false, message: "Email or password is incorrect" });
    }
    // updateOne, not save(): a login must not run document validation or hooks.
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    res.set("Cache-Control", "no-store");
    res.json({ success: true, token: signToken(user), user });
};

// GET /api/admin/auth/me -> { success, user }
export const me = (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, user: req.user });
};

// PATCH /api/admin/auth/password { currentPassword, newPassword } -> { success, token }
// The pre-save hook bumps tokenVersion, which signs out every other session;
// this one gets a fresh token so the owner is not logged out mid-task.
export const changePassword = async (req, res) => {
    const user = await User.findById(req.user._id).select("+password");
    if (!(await user.matchPassword(req.body.currentPassword))) {
        return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }
    user.password = req.body.newPassword;
    await user.save();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, token: signToken(user) });
};
