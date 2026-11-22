// controllers/admin/customerController.js — read-only customer book.
import Customer from "../../models/Customer.js";
import { normalizeBdPhone } from "../../utils/phone.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/admin/customers?q&page&limit -> { success, customers, total, totalPages, currentPage }
export const listCustomers = async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const q = String(req.query.q || "").trim().slice(0, 80);
    const phone = normalizeBdPhone(q);
    const filter = !q ? {} : phone ? { phone } : { name: { $regex: escapeRegex(q), $options: "i" } };
    const [customers, total] = await Promise.all([
        Customer.find(filter).sort({ lastOrderAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Customer.countDocuments(filter),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, customers, total, totalPages: Math.ceil(total / limit), currentPage: page });
};
