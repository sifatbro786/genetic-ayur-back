// models/LandingPage.js
// Single document (key "main") holding the landing page: which sections show,
// in what order, and each section's copy. Shape follows the storefront's
// defaultLanding exactly, because the dashboard's form editor
// (genetic-ayur-front/lib/schema.js) and the section components read it.
//
// `sections` is Mixed on purpose: eight differently shaped blocks whose
// fields change with the design. Phase 3 validates each section on write
// (allowed keys, string lengths, list sizes) in the admin controller instead
// of freezing every field into a schema here.
import mongoose from "mongoose";

// "products" is reserved for the multi-product grid planned for later.
export const SECTION_KEYS = ["hero", "trust", "benefits", "ingredients", "usage", "reviews", "order", "faq", "products"];

const landingPageSchema = new mongoose.Schema(
    {
        key: { type: String, default: "main", unique: true, immutable: true },
        order: {
            type: [{ type: String, enum: SECTION_KEYS }],
            validate: [(v) => new Set(v).size === v.length, "A section can appear only once"],
            default: [],
        },
        sections: { type: mongoose.Schema.Types.Mixed, default: {} },
        // Product the hero and the order form sell. When more products exist
        // the order form can list others too; this one is preselected.
        productSlug: { type: String, trim: true, lowercase: true, default: "" },
    },
    { timestamps: true, minimize: false },
);

landingPageSchema.statics.getMain = function () {
    return this.findOne({ key: "main" });
};

export default mongoose.model("LandingPage", landingPageSchema);
