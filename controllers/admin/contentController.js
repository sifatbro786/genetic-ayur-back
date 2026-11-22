// controllers/admin/contentController.js — store settings and landing page.
// GET returns the full documents (hidden sections, disabled wallet numbers):
// the public endpoints strip those, the dashboard must see them to edit them.
import { bkashConfigured, sslcommerzConfigured } from "../../config/env.js";
import LandingPage, { SECTION_KEYS } from "../../models/LandingPage.js";
import Product from "../../models/Product.js";
import SiteSettings from "../../models/SiteSettings.js";
import { cleanSection } from "../../services/landingSchema.js";
import { revalidateStorefront } from "../../services/revalidate.js";

const fail = (res, status, message, errors) => res.status(status).json({ success: false, message, ...(errors ? { errors } : {}) });
const notSeeded = (res) => fail(res, 503, "Store content is not set up yet. Run npm run seed.");

// Top-level settings the dashboard may change. `key` and timestamps are not.
const SITE_FIELDS = ["storeName", "storeNameBn", "logo", "phone", "whatsapp", "email", "address", "facebook", "announcement", "shipping", "payment", "footer", "legal", "seo"];

// {payment: {bkash: {number: "x"}}} -> [["payment.bkash.number", "x"]].
// Leaf by leaf, so sending one nested field never resets its siblings to
// their defaults (which a whole-object set on a nested path would do).
// Arrays (shipping) are leaves: they are always sent whole.
const flatten = (obj, prefix = "", out = []) => {
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        // null would wipe a whole sub-document; send "" to clear a field.
        if (v === null) continue;
        if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
        else out.push([path, v]);
    }
    return out;
};

// Settings that are on but cannot work yet, shown as a banner in the dashboard.
const siteWarnings = (site) => {
    const p = site.payment || {};
    const w = [];
    if (p.bkash?.enabled && p.bkash.mode === "gateway" && !bkashConfigured()) w.push("bKash is in gateway mode but the bKash keys are not in .env, so bKash is hidden from shoppers.");
    if (p.online?.enabled && !sslcommerzConfigured()) w.push("Online payment is on but the SSLCommerz keys are not in .env, so it is hidden from shoppers.");
    return w;
};

const siteResponse = (site) => ({
    success: true,
    site,
    gateways: { bkash: bkashConfigured(), sslcommerz: sslcommerzConfigured() },
    warnings: siteWarnings(site),
});

// GET /api/admin/site
export const getSite = async (_req, res) => {
    const site = await SiteSettings.getMain().lean();
    if (!site) return notSeeded(res);
    res.set("Cache-Control", "no-store");
    res.json(siteResponse(site));
};

// PUT /api/admin/site  any subset of SITE_FIELDS -> { success, site, gateways, warnings }
// The model does the real validation (zones, wallet numbers, advance rule).
export const updateSite = async (req, res) => {
    const site = await SiteSettings.getMain();
    if (!site) return notSeeded(res);
    const picked = Object.fromEntries(SITE_FIELDS.filter((k) => req.body[k] !== undefined).map((k) => [k, req.body[k]]));
    if (!Object.keys(picked).length) return fail(res, 400, "Nothing to update");
    for (const [path, value] of flatten(picked)) {
        // Unknown paths are skipped instead of silently creating junk.
        if (site.schema.path(path) || site.schema.pathType(path) === "nested") site.set(path, value);
    }
    await site.save();
    revalidateStorefront(["storefront"]);
    res.json(siteResponse(site.toObject()));
};

// GET /api/admin/landing
export const getLanding = async (_req, res) => {
    const landing = await LandingPage.getMain().lean();
    if (!landing) return notSeeded(res);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, landing, sectionKeys: SECTION_KEYS });
};

// PUT /api/admin/landing  { order?, productSlug?, sections?: { [key]: section } }
// Each section sent replaces that section (cleaned by services/landingSchema);
// sections not sent are left alone.
export const updateLanding = async (req, res) => {
    const landing = await LandingPage.getMain();
    if (!landing) return notSeeded(res);
    const { order, productSlug, sections } = req.body;
    const errors = [];

    const cleaned = {};
    if (sections !== undefined) {
        if (!sections || typeof sections !== "object" || Array.isArray(sections)) return fail(res, 400, "sections must be an object");
        for (const [key, value] of Object.entries(sections)) {
            const r = cleanSection(key, value);
            if (r.ok) cleaned[key] = r.value;
            else errors.push(...r.errors);
        }
    }
    if (productSlug !== undefined) {
        const exists = await Product.exists({ slug: String(productSlug).toLowerCase(), isActive: true });
        if (!exists) errors.push("productSlug must be an active product");
    }
    if (errors.length) return fail(res, 400, errors[0], errors.map((message) => ({ message })));

    if (order !== undefined) landing.order = order;
    if (productSlug !== undefined) landing.productSlug = productSlug;
    if (Object.keys(cleaned).length) {
        landing.sections = { ...(landing.sections || {}), ...cleaned };
        // Mixed path: Mongoose cannot see changes inside it on its own.
        landing.markModified("sections");
    }
    await landing.save();
    revalidateStorefront(["storefront"]);
    res.json({ success: true, landing: landing.toObject(), sectionKeys: SECTION_KEYS });
};
