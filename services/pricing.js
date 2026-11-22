// services/pricing.js
// THE place money is decided. POST /api/checkout/calculate shows these numbers
// and (Phase 2) createOrder charges exactly these numbers, by calling the same
// function. Nothing the browser sends about price, shipping or totals is read.
//
// priceCart() is pure (data in, totals out) so it is unit tested without a
// database; quoteOrder() loads the data and calls it.
import Product from "../models/Product.js";
import SiteSettings from "../models/SiteSettings.js";
import { findVariant, variantKey } from "../utils/variants.js";

// Same cap as the storefront form. Bigger COD orders are almost always
// resellers or fake; they are asked to call instead.
export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 10;

const fail = (status, code, message, extra = {}) => ({ ok: false, status, code, message, ...extra });

/**
 * @param {object} p
 * @param {Map<string, object>} p.products  slug -> product (plain object)
 * @param {object} p.site                   SiteSettings (plain object)
 * @param {{slug:string, options:Array, quantity:number}[]} p.items
 * @param {string} p.zoneKey
 * @param {string} [p.paymentMethod]
 */
export const priceCart = ({ products, site, items, zoneKey, paymentMethod }) => {
    if (!Array.isArray(items) || items.length === 0) return fail(400, "EMPTY", "কোনো পণ্য বেছে নেওয়া হয়নি।");

    // Merge repeated lines first. Otherwise two lines of the same pack with
    // quantity 10 each would slip past the per line cap and the stock check.
    const merged = new Map();
    for (const it of items) {
        const k = `${String(it.slug).trim().toLowerCase()}#${variantKey(it.options)}`;
        const prev = merged.get(k);
        merged.set(k, { ...it, quantity: (prev?.quantity || 0) + Number(it.quantity) });
    }
    if (merged.size > MAX_LINES) return fail(400, "TOO_MANY_LINES", "একসাথে এত পণ্য অর্ডার করা যাবে না।");

    const lines = [];
    const unitsByProduct = new Map();
    for (const it of merged.values()) {
        const product = products.get(String(it.slug).trim().toLowerCase());
        if (!product || !product.isActive) {
            return fail(404, "PRODUCT_UNAVAILABLE", "পণ্যটি এখন পাওয়া যাচ্ছে না।", { slug: it.slug });
        }
        const variant = findVariant(product, it.options);
        if (!variant) return fail(400, "PACK_NOT_FOUND", "এই প্যাকটি আর নেই। পাতাটি রিফ্রেশ করে আবার চেষ্টা করুন।", { slug: it.slug });

        const quantity = Number(it.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) return fail(400, "BAD_QUANTITY", "পরিমাণ সঠিক নয়।");
        if (quantity > MAX_QTY_PER_LINE) {
            return fail(400, "QUANTITY_LIMIT", `একবারে সর্বোচ্চ ${MAX_QTY_PER_LINE}টি অর্ডার করা যাবে। বেশি লাগলে ফোন করুন।`);
        }

        const units = (variant.units || 1) * quantity;
        unitsByProduct.set(product.slug, (unitsByProduct.get(product.slug) || 0) + units);

        lines.push({
            productId: product._id ? String(product._id) : undefined,
            slug: product.slug,
            name: product.name,
            nameBn: product.nameBn,
            image: product.image,
            // Echo the options as stored, so the client can send them back verbatim.
            options: variant.options.map(({ name, value }) => ({ name, value })),
            note: variant.note || "",
            unitPrice: variant.price,
            comparePrice: variant.comparePrice || 0,
            quantity,
            units,
            freeShipping: Boolean(variant.freeShipping),
            lineTotal: variant.price * quantity,
        });
    }

    // Different packs of one product draw from the same jars, so the check is
    // per product, not per line.
    for (const [slug, needed] of unitsByProduct) {
        const product = products.get(slug);
        if (needed > (product.stock || 0)) {
            return fail(409, "OUT_OF_STOCK", "দুঃখিত, এই পরিমাণ স্টকে নেই। পরিমাণ কমিয়ে চেষ্টা করুন অথবা ফোন করুন।", { slug });
        }
    }

    const zone = (site.shipping || []).find((z) => z.key === zoneKey && z.enabled);
    if (!zone) return fail(400, "ZONE_UNAVAILABLE", "ডেলিভারি এলাকা নির্বাচন করুন।");

    const p = site.payment || {};
    const enabled = [p.cod?.enabled && "COD", p.bkash?.enabled && "bKash", p.nagad?.enabled && "Nagad"].filter(Boolean);
    const method = paymentMethod || enabled[0];
    if (!method || !enabled.includes(method)) return fail(400, "PAYMENT_UNAVAILABLE", "এই পেমেন্ট পদ্ধতি এখন চালু নেই।");

    const itemsPrice = lines.reduce((s, l) => s + l.lineTotal, 0);
    // A free delivery pack covers the whole parcel: one courier trip either way.
    const freeShippingApplied = lines.some((l) => l.freeShipping);
    const shippingPrice = freeShippingApplied ? 0 : zone.charge;
    const totalPrice = itemsPrice + shippingPrice;

    // What the shopper must send by bKash/Nagad before the order is processed.
    let payNow = 0;
    if (method === "bKash" || method === "Nagad") payNow = totalPrice;
    else if (p.codAdvance === "delivery") payNow = shippingPrice;

    return {
        ok: true,
        totals: {
            items: lines,
            itemsPrice,
            shippingPrice,
            totalPrice,
            savings: lines.reduce((s, l) => s + Math.max(0, l.comparePrice - l.unitPrice) * l.quantity, 0),
            freeShippingApplied,
            zone: { key: zone.key, label: zone.label, charge: zone.charge },
            paymentMethod: method,
            availablePaymentMethods: enabled,
            payNow,
            payOnDelivery: totalPrice - payNow,
            // A COD order with an advance still needs a wallet reference.
            requiresTrxId: payNow > 0,
        },
    };
};

/** Loads products and settings, then prices. Used by calculate and createOrder. */
export const quoteOrder = async ({ items, zoneKey, paymentMethod }) => {
    const slugs = [...new Set((items || []).map((i) => String(i.slug).trim().toLowerCase()))];
    const [docs, site] = await Promise.all([
        Product.find({ slug: { $in: slugs } }).lean(),
        SiteSettings.getMain().lean(),
    ]);
    if (!site) return fail(503, "NOT_SEEDED", "Store settings are missing. Run npm run seed.");
    return priceCart({ products: new Map(docs.map((d) => [d.slug, d])), site, items, zoneKey, paymentMethod });
};
