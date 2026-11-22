// models/StockMovement.js
// Append-only ledger of every stock change. Product.stock is the running
// balance; this says why it is what it is ("120 last week, 97 now: 21 sold,
// 2 damaged"). Written by services/stock.js only, never edited.
import mongoose from "mongoose";

export const MOVEMENT_REASONS = ["initial", "restock", "correction", "damaged", "order", "order_cancelled"];

const stockMovementSchema = new mongoose.Schema(
    {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        // Signed units: +24 restock, -2 sold.
        change: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },
        reason: { type: String, enum: MOVEMENT_REASONS, required: true },
        order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
        orderNumber: { type: String },
        note: { type: String, trim: true, maxlength: 300, default: "" },
        // Omitted for system entries (order flow), never the string "system".
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

stockMovementSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model("StockMovement", stockMovementSchema);
