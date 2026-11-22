// services/customers.js — the phone-keyed customer book. Best effort: a
// failure here is logged and never fails the order or the status change.
import Customer from "../models/Customer.js";

export const recordNewOrder = (order) =>
    Customer.updateOne(
        { phone: order.shippingAddress.phone },
        {
            $set: {
                name: order.shippingAddress.name,
                address: order.shippingAddress.addressLine1,
                zone: order.shippingAddress.locationType,
                lastOrderAt: order.createdAt,
            },
            $setOnInsert: { firstOrderAt: order.createdAt },
            $inc: { orderCount: 1 },
        },
        { upsert: true },
    ).catch((err) => console.error("Customer book update failed:", err.message));

export const recordOutcome = (order, status) => {
    const inc =
        status === "Delivered" ? { deliveredCount: 1, totalSpent: order.totalPrice } : status === "Cancelled" ? { cancelledCount: 1 } : null;
    if (!inc) return Promise.resolve();
    return Customer.updateOne({ phone: order.shippingAddress.phone }, { $inc: inc }).catch((err) =>
        console.error("Customer book update failed:", err.message),
    );
};
