// models/Customer.js
// Customer book keyed by phone (shoppers have no accounts). Filled from
// orders. The counters let the shop spot a number with a history of
// cancelled COD orders before confirming the next one.
import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
    {
        phone: { type: String, required: true, unique: true, match: /^01[3-9]\d{8}$/ },
        name: { type: String, trim: true, maxlength: 80, default: "" },
        address: { type: String, trim: true, maxlength: 300, default: "" },
        zone: { type: String, default: "" },
        orderCount: { type: Number, default: 0 },
        deliveredCount: { type: Number, default: 0 },
        cancelledCount: { type: Number, default: 0 },
        // Sum of delivered orders' totals, BDT.
        totalSpent: { type: Number, default: 0 },
        firstOrderAt: { type: Date },
        lastOrderAt: { type: Date },
    },
    { timestamps: true },
);

customerSchema.index({ lastOrderAt: -1 });

export default mongoose.model("Customer", customerSchema);
