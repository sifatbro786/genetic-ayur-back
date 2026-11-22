// utils/variants.js
// Variants have no _id (Footpath rule). A variant is identified only by its
// options array, compared as a key built from the pairs: trimmed, lowercased,
// sorted by name. The storefront sends the options exactly as the API returned
// them; a mismatch is a 400 "pack not found", never a wrong price or a skipped
// stock deduction.
const norm = (s) => String(s ?? "").trim().toLowerCase();

export const variantKey = (options = []) =>
    (Array.isArray(options) ? options : [])
        .map((o) => `${norm(o?.name)}=${norm(o?.value)}`)
        .sort()
        .join("|");

export const findVariant = (product, options) => {
    const key = variantKey(options);
    return (product?.variants || []).find((v) => variantKey(v.options) === key) || null;
};

export const variantLabel = (options = []) => options.map((o) => o.value).join(" / ");
