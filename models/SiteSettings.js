// models/SiteSettings.js
// Single document (key "main"): store identity, contact, delivery zones,
// payment methods, footer, legal pages, SEO. Shape follows the storefront's
// defaultSite. Money related parts (shipping, payment) are typed and
// validated; the rest is plain text the dashboard edits.
import mongoose from "mongoose";
import { normalizeBdPhone } from "../utils/phone.js";

// Same keys as Footpath's ShippingConfig so orders map 1:1 with the base.
export const ZONE_KEYS = ["dhaka_inside", "dhaka_sub", "outside_dhaka"];
export const PAYMENT_METHODS = ["COD", "bKash", "Nagad"];

const zoneSchema = new mongoose.Schema(
    {
        key: { type: String, enum: ZONE_KEYS, required: true },
        label: { type: String, required: true, trim: true, maxlength: 60 },
        charge: { type: Number, required: true, min: 0 },
        enabled: { type: Boolean, default: true },
    },
    { _id: false },
);

// bKash and Nagad are manual: the shopper sends money to this number from
// their own app and types the TrxID into the order form. The shop verifies it
// in the dashboard. No gateway, no API keys.
const walletSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: false },
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
    for (const name of ["bkash", "nagad"]) {
        const w = p[name];
        if (!w?.enabled) continue;
        const n = normalizeBdPhone(w.number);
        if (!n) this.invalidate(`payment.${name}.number`, `${name === "bkash" ? "bKash" : "Nagad"} number is not a valid mobile number`);
        else w.number = n;
    }
    const wallet = p.bkash?.enabled || p.nagad?.enabled;
    if (!p.cod?.enabled && !wallet) this.invalidate("payment", "Turn on at least one payment method");
    // An advance can only be collected through a wallet.
    if (p.codAdvance === "delivery" && !wallet) {
        this.invalidate("payment.codAdvance", "Turn on bKash or Nagad before asking for the delivery charge in advance");
    }
});

/** Methods the storefront may offer right now, in display order. */
siteSettingsSchema.methods.enabledPaymentMethods = function () {
    const p = this.payment || {};
    return [p.cod?.enabled && "COD", p.bkash?.enabled && "bKash", p.nagad?.enabled && "Nagad"].filter(Boolean);
};

siteSettingsSchema.statics.getMain = function () {
    return this.findOne({ key: "main" });
};

export default mongoose.model("SiteSettings", siteSettingsSchema);
