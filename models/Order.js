// models/Order.js
// Field names follow the Footpath Order (orderItems, shippingAddress,
// itemsPrice, shippingPrice, totalPrice, orderStatus, paymentStatus,
// statusHistory) so dashboards and reports map 1:1 with the base. Every money
// field here is copied from services/pricing.js at order time; nothing in an
// order comes from the request except who and where.
import mongoose from "mongoose";
import { PAYMENT_METHODS, ZONE_KEYS } from "./SiteSettings.js";

export const ORDER_STATUSES = ["Pending", "Confirmed", "Processing", "Shipped", "Delivered", "Cancelled"];

// Pending      nothing received yet (COD, or a gateway payment not finished)
// Verifying    manual bKash/Nagad TrxID submitted, shop has not checked it
// Advance Paid the advance (payNow) is in, the rest is cash on delivery
// Paid         everything received (prepaid, or COD after delivery)
// Failed       gateway failed/cancelled, or the shop rejected the TrxID
// Refunded     money returned (recorded by the shop; no gateway refund API)
export const PAYMENT_STATUSES = ["Pending", "Verifying", "Advance Paid", "Paid", "Failed", "Refunded"];

// Which status may follow which. Anything else is refused, so a Delivered
// order cannot slide back to Pending and double count stock.
export const STATUS_FLOW = {
    Pending: ["Confirmed", "Cancelled"],
    Confirmed: ["Processing", "Shipped", "Cancelled"],
    Processing: ["Shipped", "Cancelled"],
    // Shipped -> Cancelled is a returned parcel.
    Shipped: ["Delivered", "Cancelled"],
    Delivered: [],
    Cancelled: [],
};

const optionSchema = new mongoose.Schema({ name: String, value: String }, { _id: false });

const orderItemSchema = new mongoose.Schema(
    {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        slug: { type: String, required: true },
        name: { type: String, required: true },
        nameBn: { type: String, default: "" },
        image: { type: String, default: "" },
        variant: { options: { type: [optionSchema], default: [] } },
        note: { type: String, default: "" },
        quantity: { type: Number, required: true, min: 1 },
        // Stock units this line takes (pack units x quantity).
        units: { type: Number, required: true, min: 1 },
        // Unit price, as in Footpath's orderItemSchema.
        price: { type: Number, required: true, min: 0 },
        comparePrice: { type: Number, default: 0 },
        freeShipping: { type: Boolean, default: false },
        lineTotal: { type: Number, required: true, min: 0 },
    },
    { _id: false },
);

const statusEntrySchema = new mongoose.Schema(
    {
        status: { type: String, enum: ORDER_STATUSES, required: true },
        note: { type: String, maxlength: 300, default: "" },
        // Omitted for system entries. Never the string "system": it would be
        // cast to ObjectId and silently dropped (Footpath trap).
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const noteSchema = new mongoose.Schema(
    {
        note: { type: String, required: true, maxlength: 1000 },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        addedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const manualPaymentSchema = new mongoose.Schema(
    {
        method: { type: String, enum: ["bKash", "Nagad"], required: true },
        senderNumber: { type: String, required: true },
        // Uppercased. Unique across orders (index below): one payment cannot
        // back two orders.
        trxId: { type: String, required: true, uppercase: true, trim: true },
        // What the shopper was asked to send (payNow at order time).
        amount: { type: Number, required: true, min: 0 },
        submittedAt: { type: Date, default: Date.now },
        verifiedAt: { type: Date },
        verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        rejectedAt: { type: Date },
        rejectReason: { type: String, maxlength: 300 },
        // Earlier rejected TrxIDs, kept for the audit trail.
        previous: {
            type: [{ _id: false, trxId: String, senderNumber: String, rejectedAt: Date, rejectReason: String }],
            default: undefined,
        },
    },
    { _id: false },
);

const gatewayPaymentSchema = new mongoose.Schema(
    {
        provider: { type: String, enum: ["bkash", "sslcommerz"], required: true },
        // bKash paymentID / SSLCommerz tran_id of the CURRENT attempt.
        sessionId: { type: String },
        attempts: { type: Number, default: 0 },
        amount: { type: Number, min: 0 },
        // Filled on success, from the gateway's verified answer only.
        trxId: { type: String },
        valId: { type: String },
        bankTranId: { type: String },
        cardType: { type: String },
        paidAt: { type: Date },
        // Short reason of the last failure (status word, never a full body).
        lastError: { type: String, maxlength: 200 },
    },
    { _id: false },
);

const orderSchema = new mongoose.Schema(
    {
        orderNumber: { type: String, required: true, unique: true, immutable: true },
        orderItems: { type: [orderItemSchema], validate: [(v) => v.length > 0, "Order has no items"] },
        shippingAddress: {
            name: { type: String, required: true, trim: true, maxlength: 80 },
            phone: { type: String, required: true, match: /^01[3-9]\d{8}$/ },
            addressLine1: { type: String, required: true, trim: true, maxlength: 300 },
            locationType: { type: String, enum: ZONE_KEYS, required: true },
            locationLabel: { type: String, default: "" },
        },
        customerNote: { type: String, trim: true, maxlength: 500, default: "" },

        paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
        // How payNow is collected (copied from pricing): { method, flow, provider }
        payNowVia: { method: String, flow: String, provider: String },
        itemsPrice: { type: Number, required: true, min: 0 },
        shippingPrice: { type: Number, required: true, min: 0 },
        totalPrice: { type: Number, required: true, min: 0 },
        savings: { type: Number, default: 0 },
        freeShippingApplied: { type: Boolean, default: false },
        payNow: { type: Number, required: true, min: 0 },
        payOnDelivery: { type: Number, required: true, min: 0 },
        amountPaid: { type: Number, default: 0, min: 0 },
        paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "Pending" },
        manualPayment: { type: manualPaymentSchema, default: undefined },
        gatewayPayment: { type: gatewayPaymentSchema, default: undefined },

        orderStatus: { type: String, enum: ORDER_STATUSES, default: "Pending" },
        statusHistory: { type: [statusEntrySchema], default: [] },
        adminNotes: { type: [noteSchema], default: [] },
        confirmedAt: Date,
        deliveredAt: Date,
        cancelledAt: Date,

        // True while this order's units are taken out of Product.stock.
        stockDeducted: { type: Boolean, default: false },

        // SHA-256 of the guest token. The token itself is shown once, in the
        // create response; a database leak does not open every order.
        guestAccessTokenHash: { type: String, required: true, select: false },
        // Optional client generated id: a double tap or a retry after a
        // dropped connection returns the first order instead of a second one.
        clientRequestId: { type: String, select: false },
    },
    { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ "shippingAddress.phone": 1, createdAt: -1 });
orderSchema.index(
    { "manualPayment.trxId": 1 },
    { unique: true, partialFilterExpression: { "manualPayment.trxId": { $type: "string" } } },
);
orderSchema.index(
    { "gatewayPayment.provider": 1, "gatewayPayment.trxId": 1 },
    { unique: true, partialFilterExpression: { "gatewayPayment.trxId": { $type: "string" } } },
);
orderSchema.index({ "gatewayPayment.sessionId": 1 }, { partialFilterExpression: { "gatewayPayment.sessionId": { $type: "string" } } });
orderSchema.index({ clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: "string" } } });

export default mongoose.model("Order", orderSchema);
