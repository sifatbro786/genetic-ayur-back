// services/stock.js
// Stock is single units (jars) on the product; an order line carries the
// units it takes (pack units x quantity). Each product is changed with a
// conditional $inc, so two orders racing for the last jar cannot both win.
// No multi-document transaction: a failed product rolls back the ones already
// taken, which works on a standalone MongoDB too.
//
// Every change also lands in StockMovement (the ledger). The ledger write is
// best effort AFTER the stock change: a lost ledger line is a reporting gap,
// a failed stock change caused by the ledger would be a lost sale.
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";

export const unitsByProduct = (orderItems) => {
    const map = new Map();
    for (const it of orderItems || []) {
        const id = String(it.product);
        map.set(id, (map.get(id) || 0) + it.units);
    }
    return map;
};

const log = (entries) =>
    entries.length
        ? StockMovement.insertMany(entries, { ordered: false }).catch((err) => console.error("Stock ledger write failed:", err.message))
        : Promise.resolve();

/**
 * Takes units from several products, all or nothing.
 * @param {Map<string, number>} units
 * @param {object} [meta] { reason, order, orderNumber, note, by }
 * @returns {Promise<{ok: true} | {ok: false, productId: string}>}
 */
export const takeUnits = async (units, meta = { reason: "order" }) => {
    const done = [];
    for (const [productId, n] of units) {
        const p = await Product.findOneAndUpdate(
            { _id: productId, stock: { $gte: n } },
            { $inc: { stock: -n } },
            { new: true, projection: { stock: 1 } },
        );
        if (!p) {
            await returnUnits(new Map(done.map((d) => [d.productId, d.n])), null);
            return { ok: false, productId };
        }
        done.push({ productId, n, balanceAfter: p.stock });
    }
    await log(done.map((d) => ({ ...meta, product: d.productId, change: -d.n, balanceAfter: d.balanceAfter })));
    return { ok: true };
};

/** Gives units back. meta null = silent rollback of a partial take (no ledger). */
export const returnUnits = async (units, meta = { reason: "order_cancelled" }) => {
    const done = [];
    for (const [productId, n] of units) {
        const p = await Product.findOneAndUpdate({ _id: productId }, { $inc: { stock: n } }, { new: true, projection: { stock: 1 } });
        if (p) done.push({ productId, n, balanceAfter: p.stock });
    }
    if (meta) await log(done.map((d) => ({ ...meta, product: d.productId, change: d.n, balanceAfter: d.balanceAfter })));
};

const orderMeta = (order, reason) => ({ reason, order: order._id, orderNumber: order.orderNumber });

// The stockDeducted flag is claimed atomically before touching products, so
// two dashboard tabs confirming the same order deduct once.
export const deductForOrder = async (order) => {
    const claim = await Order.updateOne({ _id: order._id, stockDeducted: false }, { $set: { stockDeducted: true } });
    if (claim.modifiedCount !== 1) return { ok: true, already: true };
    const r = await takeUnits(unitsByProduct(order.orderItems), orderMeta(order, "order"));
    if (!r.ok) await Order.updateOne({ _id: order._id }, { $set: { stockDeducted: false } });
    return r;
};

export const restoreForOrder = async (order) => {
    const claim = await Order.updateOne({ _id: order._id, stockDeducted: true }, { $set: { stockDeducted: false } });
    if (claim.modifiedCount !== 1) return false;
    await returnUnits(unitsByProduct(order.orderItems), orderMeta(order, "order_cancelled"));
    return true;
};

/**
 * Dashboard stock change. `change` is signed; a negative change cannot take
 * stock below zero (conditional update, so a sale landing at the same moment
 * is never lost).
 * @returns {Promise<{ok: true, stock: number} | {ok: false, stock: number}>}
 */
export const adjustStock = async (productId, change, { reason, note = "", by }) => {
    const cond = change < 0 ? { _id: productId, stock: { $gte: -change } } : { _id: productId };
    const p = await Product.findOneAndUpdate(cond, { $inc: { stock: change } }, { new: true, projection: { stock: 1 } });
    if (!p) {
        const cur = await Product.findById(productId).select("stock").lean();
        return { ok: false, stock: cur?.stock ?? 0, missing: !cur };
    }
    await log([{ product: productId, change, balanceAfter: p.stock, reason, note, by }]);
    return { ok: true, stock: p.stock };
};
