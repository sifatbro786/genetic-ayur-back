// services/stock.js
// Stock is single units (jars) on the product; an order line carries the
// units it takes (pack units x quantity). Each product is decremented with a
// conditional $inc, so two orders racing for the last jar cannot both win.
// No multi-document transaction: a failed product rolls back the ones already
// taken, which works on a standalone MongoDB too.
import Order from "../models/Order.js";
import Product from "../models/Product.js";

export const unitsByProduct = (orderItems) => {
    const map = new Map();
    for (const it of orderItems || []) {
        const id = String(it.product);
        map.set(id, (map.get(id) || 0) + it.units);
    }
    return map;
};

/** @returns {Promise<{ok: true} | {ok: false, productId: string}>} */
export const takeUnits = async (units) => {
    const done = [];
    for (const [productId, n] of units) {
        const r = await Product.updateOne({ _id: productId, stock: { $gte: n } }, { $inc: { stock: -n } });
        if (r.modifiedCount !== 1) {
            await returnUnits(new Map(done));
            return { ok: false, productId };
        }
        done.push([productId, n]);
    }
    return { ok: true };
};

export const returnUnits = async (units) => {
    for (const [productId, n] of units) {
        await Product.updateOne({ _id: productId }, { $inc: { stock: n } });
    }
};

// The stockDeducted flag is claimed atomically before touching products, so
// two dashboard tabs confirming the same order deduct once.
export const deductForOrder = async (order) => {
    const claim = await Order.updateOne({ _id: order._id, stockDeducted: false }, { $set: { stockDeducted: true } });
    if (claim.modifiedCount !== 1) return { ok: true, already: true };
    const r = await takeUnits(unitsByProduct(order.orderItems));
    if (!r.ok) await Order.updateOne({ _id: order._id }, { $set: { stockDeducted: false } });
    return r;
};

export const restoreForOrder = async (order) => {
    const claim = await Order.updateOne({ _id: order._id, stockDeducted: true }, { $set: { stockDeducted: false } });
    if (claim.modifiedCount !== 1) return false;
    await returnUnits(unitsByProduct(order.orderItems));
    return true;
};
