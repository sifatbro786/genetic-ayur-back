// controllers/admin/orderController.js — dashboard order management.
// Messages are English (dashboard language). Every state change is a
// conditional update on the state it was read in, so two people working the
// same order in two tabs cannot both apply a change.
import Customer from "../../models/Customer.js";
import Order, { ORDER_STATUSES, PAYMENT_STATUSES, STATUS_FLOW } from "../../models/Order.js";
import Product from "../../models/Product.js";
import { recordOutcome } from "../../services/customers.js";
import { recheckGatewayPayment } from "../../services/payments/index.js";
import { deductForOrder, restoreForOrder } from "../../services/stock.js";
import { normalizeBdPhone } from "../../utils/phone.js";

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const PAID = ["Advance Paid", "Paid"];

const buildFilter = (q) => {
    const filter = {};
    if (ORDER_STATUSES.includes(q.status)) filter.orderStatus = q.status;
    if (PAYMENT_STATUSES.includes(q.paymentStatus)) filter.paymentStatus = q.paymentStatus;
    if (["COD", "bKash", "Nagad", "Online"].includes(q.paymentMethod)) filter.paymentMethod = q.paymentMethod;
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    if ((from && !isNaN(from)) || (to && !isNaN(to))) {
        filter.createdAt = {};
        if (from && !isNaN(from)) filter.createdAt.$gte = from;
        // A bare date ("2026-11-22") means the whole day.
        if (to && !isNaN(to)) filter.createdAt.$lte = /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? new Date(to.getTime() + 86_399_999) : to;
    }
    const search = String(q.q || "").trim().slice(0, 80);
    if (search) {
        const phone = normalizeBdPhone(search);
        if (/^GA\d+$/i.test(search)) filter.orderNumber = { $regex: `^${escapeRegex(search.toUpperCase())}` };
        else if (phone) filter["shippingAddress.phone"] = phone;
        else if (/^[\d০-৯]{4,}$/.test(search)) filter["shippingAddress.phone"] = { $regex: escapeRegex(search.replace(/[০-৯]/g, (c) => "০১২৩৪৫৬৭৮৯".indexOf(c))) };
        else if (/^[A-Za-z0-9]{6,20}$/.test(search) && /\d/.test(search) && /[A-Za-z]/.test(search)) {
            filter.$or = [{ "manualPayment.trxId": search.toUpperCase() }, { "gatewayPayment.trxId": search }, { "shippingAddress.name": { $regex: escapeRegex(search), $options: "i" } }];
        } else filter["shippingAddress.name"] = { $regex: escapeRegex(search), $options: "i" };
    }
    return filter;
};

// GET /api/admin/orders?status&paymentStatus&paymentMethod&q&from&to&page&limit
// 200 { success, orders, total, totalPages, currentPage, statusCounts, needsAttention }
export const listOrders = async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = buildFilter(req.query);
    const [orders, total, counts, verifying] = await Promise.all([
        Order.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select("-statusHistory -adminNotes -orderItems.image")
            .lean(),
        Order.countDocuments(filter),
        Order.aggregate([{ $group: { _id: "$orderStatus", n: { $sum: 1 } } }]),
        Order.countDocuments({ paymentStatus: "Verifying", orderStatus: { $ne: "Cancelled" } }),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({
        success: true,
        orders,
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        statusCounts: Object.fromEntries(ORDER_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.n || 0])),
        // Badge for the sidebar: payments waiting for a human check.
        needsAttention: { paymentsToVerify: verifying },
    });
};

// Excel opens a cell starting with = + - @ as a formula; a shopper could type
// "=HYPERLINK(...)" as their name. Prefix those with a quote.
const csvCell = (v) => {
    let s = v === undefined || v === null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// GET /api/admin/orders/export (same filters) -> text/csv, max 5000 rows
export const exportOrders = async (req, res) => {
    const orders = await Order.find(buildFilter(req.query)).sort({ createdAt: -1 }).limit(5000).lean();
    const head = ["Order", "Date", "Status", "Payment", "Method", "Name", "Phone", "Address", "Zone", "Items", "Items price", "Delivery", "Total", "Pay now", "Paid", "Cash on delivery", "TrxID", "Note"];
    const rows = orders.map((o) => [
        o.orderNumber,
        new Date(o.createdAt).toISOString(),
        o.orderStatus,
        o.paymentStatus,
        o.paymentMethod,
        o.shippingAddress.name,
        o.shippingAddress.phone,
        o.shippingAddress.addressLine1,
        o.shippingAddress.locationLabel,
        o.orderItems.map((i) => `${i.nameBn || i.name} (${i.variant.options.map((x) => x.value).join("/")}) x${i.quantity}`).join("; "),
        o.itemsPrice,
        o.shippingPrice,
        o.totalPrice,
        o.payNow,
        o.amountPaid,
        o.payOnDelivery,
        o.manualPayment?.trxId || o.gatewayPayment?.trxId || "",
        o.customerNote,
    ]);
    const csv = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    res.set("Cache-Control", "no-store");
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    // BOM so Excel reads the Bangla names as UTF-8.
    res.send(`﻿${csv}`);
};

const loadDetail = (orderNumber) =>
    Order.findOne({ orderNumber })
        .populate("statusHistory.updatedBy", "name email")
        .populate("adminNotes.addedBy", "name email")
        .populate("manualPayment.verifiedBy", "name email")
        .lean();

// GET /api/admin/orders/:orderNumber -> { success, order, customer }
// `customer` carries the phone's history (cancelled COD orders) for the call.
export const getOrder = async (req, res) => {
    const order = await loadDetail(req.params.orderNumber);
    if (!order) return fail(res, 404, "Order not found");
    const customer = await Customer.findOne({ phone: order.shippingAddress.phone }).lean();
    res.set("Cache-Control", "no-store");
    res.json({ success: true, order, customer });
};

// PATCH /api/admin/orders/:orderNumber/status { status, note? }
export const updateStatus = async (req, res) => {
    const { status } = req.body;
    const note = String(req.body.note || "").trim();
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return fail(res, 404, "Order not found");
    const from = order.orderStatus;
    if (!STATUS_FLOW[from]?.includes(status)) return fail(res, 409, `An order cannot go from ${from} to ${status}`);

    // A prepaid or advance order is confirmed only after its money is in.
    if (status === "Confirmed" && order.payNow > 0 && !PAID.includes(order.paymentStatus)) {
        return fail(res, 409, "Verify the payment before confirming this order");
    }

    // Stock leaves the shelf on confirm (STOCK_DEDUCT_ON=confirmed). In
    // "placed" mode it is already deducted and this is a no-op.
    let deductedNow = false;
    if (status === "Confirmed") {
        const r = await deductForOrder(order);
        if (!r.ok) {
            const p = await Product.findById(r.productId).select("name stock").lean();
            return fail(res, 409, `Not enough stock for ${p?.name || "a product"} (${p?.stock ?? 0} left)`);
        }
        deductedNow = !r.already;
    }

    const now = new Date();
    const set = { orderStatus: status };
    if (status === "Confirmed") set.confirmedAt = now;
    if (status === "Delivered") {
        set.deliveredAt = now;
        // The courier collected the rest in cash.
        if (!["Paid", "Refunded"].includes(order.paymentStatus)) {
            set.paymentStatus = "Paid";
            set.amountPaid = order.totalPrice;
        }
    }
    if (status === "Cancelled") set.cancelledAt = now;

    const entry = { status, updatedBy: req.user._id, updatedAt: now, ...(note ? { note } : {}) };
    const updated = await Order.findOneAndUpdate({ _id: order._id, orderStatus: from }, { $set: set, $push: { statusHistory: entry } }, { new: true });
    if (!updated) {
        if (deductedNow) await restoreForOrder(order);
        return fail(res, 409, "This order was changed by someone else. Reload and try again.");
    }
    if (status === "Cancelled") await restoreForOrder(updated);
    recordOutcome(updated, status);

    const warning =
        status === "Cancelled" && PAID.includes(updated.paymentStatus)
            ? `Money was received for this order (৳${updated.amountPaid}). Refund it, then mark the payment Refunded.`
            : undefined;
    res.json({ success: true, order: await loadDetail(updated.orderNumber), ...(warning ? { warning } : {}) });
};

// PATCH /api/admin/orders/:orderNumber/payment { action, reason? }
//   verify   Verifying -> Paid / Advance Paid (manual TrxID checked in the
//            bKash/Nagad app, or a gateway payment held as risky)
//   reject   Verifying -> Failed (manual only; shopper may resubmit a TrxID)
//   refunded Paid / Advance Paid -> Refunded (bookkeeping; refund is done in
//            the wallet app or gateway panel)
export const updatePayment = async (req, res) => {
    const { action } = req.body;
    const reason = String(req.body.reason || "").trim();
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return fail(res, 404, "Order not found");
    const now = new Date();
    let cond, update;

    if (action === "verify") {
        if (order.paymentStatus !== "Verifying") return fail(res, 409, "There is no payment waiting for verification");
        cond = { paymentStatus: "Verifying" };
        update = {
            $set: {
                paymentStatus: order.payOnDelivery > 0 ? "Advance Paid" : "Paid",
                amountPaid: order.payNow,
                ...(order.manualPayment ? { "manualPayment.verifiedAt": now, "manualPayment.verifiedBy": req.user._id } : {}),
            },
            ...(order.gatewayPayment ? { $unset: { "gatewayPayment.lastError": 1 } } : {}),
        };
    } else if (action === "reject") {
        if (order.paymentStatus !== "Verifying" || !order.manualPayment) return fail(res, 409, "Only a submitted bKash/Nagad TrxID can be rejected");
        if (!reason) return fail(res, 400, "Give a reason; the customer sees it");
        cond = { paymentStatus: "Verifying" };
        update = { $set: { paymentStatus: "Failed", "manualPayment.rejectedAt": now, "manualPayment.rejectReason": reason } };
    } else if (action === "refunded") {
        if (!PAID.includes(order.paymentStatus)) return fail(res, 409, "Only a paid order can be marked refunded");
        if (!reason) return fail(res, 400, "Give a reason or the refund reference");
        cond = { paymentStatus: order.paymentStatus };
        update = {
            $set: { paymentStatus: "Refunded" },
            $push: { adminNotes: { note: `Refunded ৳${order.amountPaid}: ${reason}`, addedBy: req.user._id, addedAt: now } },
        };
    } else return fail(res, 400, "Unknown action");

    const updated = await Order.findOneAndUpdate({ _id: order._id, ...cond }, update, { new: true });
    if (!updated) return fail(res, 409, "This order was changed by someone else. Reload and try again.");
    res.json({ success: true, order: await loadDetail(updated.orderNumber) });
};

// POST /api/admin/orders/:orderNumber/payment/recheck
// Asks bKash/SSLCommerz directly. For a shopper who paid but closed the tab
// before the redirect, or a missed IPN.
export const recheckPayment = async (req, res) => {
    const order = await Order.findOne({ orderNumber: req.params.orderNumber });
    if (!order) return fail(res, 404, "Order not found");
    if (order.payNowVia?.flow !== "gateway") return fail(res, 409, "This order was not paid through a gateway");
    try {
        const { outcome, status } = await recheckGatewayPayment(order);
        res.json({ success: true, outcome, gatewayStatus: status, order: await loadDetail(order.orderNumber) });
    } catch (err) {
        fail(res, err.status && err.status < 500 ? err.status : 502, `Gateway check failed: ${err.message}`);
    }
};

// POST /api/admin/orders/:orderNumber/notes { note }
export const addNote = async (req, res) => {
    const updated = await Order.findOneAndUpdate(
        { orderNumber: req.params.orderNumber },
        { $push: { adminNotes: { note: String(req.body.note).trim(), addedBy: req.user._id, addedAt: new Date() } } },
        { new: true },
    );
    if (!updated) return fail(res, 404, "Order not found");
    res.json({ success: true, order: await loadDetail(updated.orderNumber) });
};
