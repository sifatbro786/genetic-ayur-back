// models/Product.js
// Deliberately much smaller than the Footpath Product (no categories,
// attributes, campaigns, A+ content, discount types). The shape matches what
// the storefront already renders (genetic-ayur-front/lib/defaults.js), so the
// same document drives the landing page and the order form.
//
// Several products are expected later (3 to 5). Each one is its own document
// with its own slug; nothing here assumes there is only one.
import mongoose from "mongoose";
import { variantKey } from "../utils/variants.js";

const optionSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 40 },
        value: { type: String, required: true, trim: true, maxlength: 60 },
    },
    { _id: false },
);

// A variant is a pack ("১ কৌটা", "২ কৌটা কম্বো"). No _id: identity is the
// options array (utils/variants.js), the same rule as the Footpath base.
const variantSchema = new mongoose.Schema(
    {
        options: { type: [optionSchema], validate: [(v) => v.length > 0, "A pack needs at least one option"] },
        note: { type: String, trim: true, maxlength: 80, default: "" },
        // Final selling price in BDT, whole taka. There is no discount engine:
        // the owner types the price; comparePrice is the struck-through one.
        price: { type: Number, required: true, min: 0 },
        comparePrice: { type: Number, min: 0, default: 0 },
        freeShipping: { type: Boolean, default: false },
        isPopular: { type: Boolean, default: false },
        // How many stock units one pack uses. Stock is counted in single jars
        // on the product, so a "২ কৌটা" pack has units: 2 and selling one of
        // it takes 2 jars. Without this, combo packs would oversell.
        units: { type: Number, min: 1, default: 1 },
    },
    { _id: false },
);

const productSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        nameBn: { type: String, required: true, trim: true, maxlength: 120 },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only use a to z, 0 to 9 and single hyphens"],
            maxlength: 80,
        },
        // Short line for a future "other products" grid on the home page.
        shortDescription: { type: String, trim: true, maxlength: 300, default: "" },
        image: { type: String, trim: true, default: "" },
        netWeight: { type: String, trim: true, maxlength: 40, default: "" },
        // Single units on hand (jars). Never sent to the storefront as a raw
        // number; the public shape exposes per pack availability instead.
        stock: { type: Number, min: 0, default: 0, validate: [Number.isInteger, "Stock must be a whole number"] },
        isActive: { type: Boolean, default: true },
        // Display order when several products are listed. Lower comes first.
        sortOrder: { type: Number, default: 0 },
        variants: {
            type: [variantSchema],
            validate: [(v) => v.length > 0, "A product needs at least one pack"],
        },
    },
    { timestamps: true, minimize: false },
);

productSchema.index({ isActive: 1, sortOrder: 1 });

productSchema.pre("validate", function () {
    // Two packs with the same options would make findVariant ambiguous and
    // the order form could charge one price and deduct the other's units.
    const seen = new Set();
    for (const v of this.variants || []) {
        const key = variantKey(v.options);
        if (seen.has(key)) {
            this.invalidate("variants", `Two packs have the same options (${v.options.map((o) => o.value).join(" / ")})`);
            return;
        }
        seen.add(key);
        if (v.comparePrice && v.comparePrice <= v.price) v.comparePrice = 0;
    }
    if (this.variants.filter((v) => v.isPopular).length > 1) {
        this.invalidate("variants", "Only one pack can be marked popular");
    }
});

export default mongoose.model("Product", productSchema);
