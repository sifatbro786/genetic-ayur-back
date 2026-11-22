// models/SiteSettings.js
// Single document (key "main"): store identity, contact, delivery zones,
// payment methods, footer, legal pages, SEO. Shape follows the storefront's
// defaultSite. Money related parts (shipping, payment) are typed and
// validated; the rest is plain text the dashboard edits.
import mongoose from "mongoose";
import { normalizeBdPhone } from "../utils/phone.js";

// Same keys as Footpath's ShippingConfig so orders map 1:1 with the base.
export const ZONE_KEYS = ["dhaka_inside", "dhaka_sub", "outside_dhaka"];
// "Online" is SSLCommerz (cards, all wallets, net banking in one hosted page).
export const PAYMENT_METHODS = ["COD", "bKash", "Nagad", "Online"];

const zoneSchema = new mongoose.Schema(
    {
        key: { type: String, enum: ZONE_KEYS, required: true },
        label: { type: String, required: true, trim: true, maxlength: 60 },
        charge: { type: Number, required: true, min: 0 },
        enabled: { type: Boolean, default: true },
    },
    { _id: false },
);

// A wallet works in one of two modes:
//   manual  : the shopper sends money to `number` from their own app and types
//             the TrxID; the shop verifies it in the dashboard. No API keys.
//   gateway : bKash Tokenized Checkout (keys in .env). The shopper is sent to
//             bKash and the payment is confirmed server to server. Nagad has
//             no direct gateway here; online Nagad goes through SSLCommerz.
// Gateway mode with missing keys hides the method instead of taking orders
// nobody can pay (services/paymentMethods.js).
const walletSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["manual", "gateway"], default: "manual" },
        number: { type: String, trim: true, default: "" },
        // Decides the wording the storefront shows: "Send Money" for a
        // personal number, "Cash Out" for agent, "Payment" for merchant.
        accountType: { type: String, enum: ["personal", "agent", "merchant"], default: "personal" },
        instructions: { type: String, trim: true, maxlength: 500, default: "" },
    },
    { _id: false },
);

const legalPageSchema = new mongoose.Schema(
    {
        title: { type: String, trim: true, maxlength: 120, default: "" },
        updated: { type: String, trim: true, maxlength: 60, default: "" },
        // Plain text with a tiny markup ("## " heading, "- " list item). The
        // storefront renders it as text, never as HTML.
        body: { type: String, maxlength: 30000, default: "" },
    },
    { _id: false },
);

const siteSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: "main", unique: true, immutable: true },
        storeName: { type: String, trim: true, maxlength: 80, default: "" },
        storeNameBn: { type: String, trim: true, maxlength: 80, default: "" },
        logo: { type: String, trim: true, default: "" },
        phone: { type: String, trim: true, maxlength: 30, default: "" },
        whatsapp: { type: String, trim: true, maxlength: 30, default: "" },
        email: { type: String, trim: true, lowercase: true, maxlength: 160, default: "" },
        address: { type: String, trim: true, maxlength: 300, default: "" },
        facebook: { type: String, trim: true, maxlength: 300, default: "" },
        announcement: {
            enabled: { type: Boolean, default: false },
            text: { type: String, trim: true, maxlength: 200, default: "" },
        },
        shipping: { type: [zoneSchema], default: [] },
        payment: {
            cod: { enabled: { type: Boolean, default: true } },
            bkash: { type: walletSchema, default: () => ({}) },
            nagad: { type: walletSchema, default: () => ({}) },
            // SSLCommerz hosted payment page. Needs SSLCZ_* in .env.
            online: {
                enabled: { type: Boolean, default: false },
                label: { type: String, trim: true, maxlength: 60, default: "কার্ড / মোবাইল ব্যাংকিং" },
            },
            // "delivery": a COD order must pay the delivery charge upfront by
            // bKash/Nagad (cuts fake orders); the product price is paid on
            // delivery. "none": nothing is paid before delivery.
            codAdvance: { type: String, enum: ["none", "delivery"], default: "none" },
        },
        footer: {
            about: { type: String, trim: true, maxlength: 500, default: "" },
            disclaimer: { type: String, trim: true, maxlength: 1000, default: "" },
            copyright: { type: String, trim: true, maxlength: 200, default: "" },
        },
        legal: {
            privacy: { type: legalPageSchema, default: () => ({}) },
            terms: { type: legalPageSchema, default: () => ({}) },
        },
        seo: {
            title: { type: String, trim: true, maxlength: 120, default: "" },
            description: { type: String, trim: true, maxlength: 300, default: "" },
        },
    },
    { timestamps: true, minimize: false },
);

siteSettingsSchema.pre("validate", function () {
    const keys = (this.shipping || []).map((z) => z.key);
    if (new Set(keys).size !== keys.length) this.invalidate("shipping", "Each delivery zone can appear only once");

    const p = this.payment || {};
    if (p.nagad?.mode === "gateway") this.invalidate("payment.nagad.mode", "Nagad has no direct gateway; use manual, or SSLCommerz (Online)");
    for (const name of ["bkash", "nagad"]) {
        const w = p[name];
        // A gateway wallet is paid inside bKash's own page; no number shown.
        if (!w?.enabled || w.mode === "gateway") continue;
        const n = normalizeBdPhone(w.number);
        if (!n) this.invalidate(`payment.${name}.number`, `${name === "bkash" ? "bKash" : "Nagad"} number is not a valid mobile number`);
        else w.number = n;
    }
    const wallet = p.bkash?.enabled || p.nagad?.enabled || p.online?.enabled;
    if (!p.cod?.enabled && !wallet) this.invalidate("payment", "Turn on at least one payment method");
    // An advance can only be collected through a wallet.
    if (p.codAdvance === "delivery" && !wallet) {
        this.invalidate("payment.codAdvance", "Turn on bKash, Nagad or online payment before asking for the delivery charge in advance");
    }
});

siteSettingsSchema.statics.getMain = function () {
    return this.findOne({ key: "main" });
};

export default mongoose.model("SiteSettings", siteSettingsSchema);
