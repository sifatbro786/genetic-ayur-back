// controllers/admin/productController.js — products and stock.
// Stock is never written by a product edit: it changes only through orders
// and POST /:id/stock, both of which go through the ledger (services/stock).
import mongoose from "mongoose";
import LandingPage from "../../models/LandingPage.js";
import Product from "../../models/Product.js";
import StockMovement from "../../models/StockMovement.js";
import { revalidateStorefront } from "../../services/revalidate.js";
import { adjustStock } from "../../services/stock.js";

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const EDITABLE = ["name", "nameBn", "slug", "shortDescription", "description", "image", "gallery", "netWeight", "isActive", "sortOrder", "variants"];

export const slugify = (s) =>
    String(s || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);

const pick = (body) => Object.fromEntries(EDITABLE.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

const landingSlug = async () => (await LandingPage.getMain().select("productSlug").lean())?.productSlug || "";

// GET /api/admin/products?q&status=active|inactive|all&page&limit
export const listProducts = async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.status === "active") filter.isActive = true;
    if (req.query.status === "inactive") filter.isActive = false;
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q) {
        const rx = { $regex: escapeRegex(q), $options: "i" };
        filter.$or = [{ name: rx }, { nameBn: rx }, { slug: rx }];
    }
    const [products, total, featured] = await Promise.all([
        Product.find(filter).sort({ sortOrder: 1, createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        Product.countDocuments(filter),
        landingSlug(),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, products, total, totalPages: Math.ceil(total / limit), currentPage: page, landingProductSlug: featured });
};

// GET /api/admin/products/:id -> { success, product }
export const getProduct = async (req, res) => {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return fail(res, 404, "Product not found");
    res.set("Cache-Control", "no-store");
    res.json({ success: true, product });
};

// POST /api/admin/products  { ...EDITABLE, stock? } -> 201 { success, product }
// The opening stock is the one time stock arrives with the product; it is
// logged as an "initial" ledger entry.
export const createProduct = async (req, res) => {
    const data = pick(req.body);
    data.slug = slugify(data.slug || data.name);
    if (!data.slug) return fail(res, 400, "Give the product an English name or a slug");
    const opening = Number.isInteger(req.body.stock) && req.body.stock > 0 ? req.body.stock : 0;
    if (data.sortOrder === undefined) {
        const last = await Product.findOne().sort({ sortOrder: -1 }).select("sortOrder").lean();
        data.sortOrder = (last?.sortOrder ?? -1) + 1;
    }
    const product = await Product.create({ ...data, stock: 0 });
    if (opening) await adjustStock(product._id, opening, { reason: "initial", by: req.user._id, note: "Opening stock" });
    revalidateStorefront(["storefront"]);
    res.status(201).json({ success: true, product: await Product.findById(product._id).lean() });
};

// PUT /api/admin/products/:id  any subset of EDITABLE. `stock` is ignored on
// purpose (use POST /:id/stock). Returns { success, product }.
export const updateProduct = async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return fail(res, 404, "Product not found");
    const data = pick(req.body);
    const oldSlug = product.slug;
    if (data.slug !== undefined) {
        data.slug = slugify(data.slug);
        if (!data.slug) return fail(res, 400, "Slug cannot be empty");
    }
    const featured = await landingSlug();
    // The landing page sells this product: hiding it would break the hero and
    // the order form. Point the landing page at another product first.
    if (data.isActive === false && featured === oldSlug) {
        return fail(res, 409, "This product is on the landing page. Choose another landing product before hiding it.");
    }
    product.set(data);
    await product.save();
    // Orders keep their own slug copy; only the landing pointer must follow.
    if (data.slug && data.slug !== oldSlug && featured === oldSlug) {
        await LandingPage.updateOne({ key: "main" }, { $set: { productSlug: data.slug } });
    }
    revalidateStorefront(["storefront"]);
    res.json({ success: true, product: product.toObject() });
};

// DELETE /api/admin/products/:id — soft: hides the product. Old orders point
// at it, so the document stays.
export const deleteProduct = async (req, res) => {
    const product = await Product.findById(req.params.id).select("slug").lean();
    if (!product) return fail(res, 404, "Product not found");
    if ((await landingSlug()) === product.slug) {
        return fail(res, 409, "This product is on the landing page. Choose another landing product before removing it.");
    }
    await Product.updateOne({ _id: product._id }, { $set: { isActive: false } });
    revalidateStorefront(["storefront"]);
    res.json({ success: true });
};

// POST /api/admin/products/:id/stock { change, reason, note? } -> { success, stock }
//   restock: change > 0   damaged: change < 0   correction: either sign
export const changeStock = async (req, res) => {
    const change = Number(req.body.change);
    const { reason } = req.body;
    if ((reason === "restock" && change < 0) || (reason === "damaged" && change > 0)) {
        return fail(res, 400, reason === "restock" ? "A restock adds stock (positive number)" : "Damaged stock is a negative number");
    }
    const r = await adjustStock(req.params.id, change, { reason, note: String(req.body.note || "").trim(), by: req.user._id });
    if (r.missing) return fail(res, 404, "Product not found");
    if (!r.ok) return fail(res, 409, `Only ${r.stock} in stock; cannot remove ${-change}`);
    // Stock decides "in stock / stock out" on the landing page.
    revalidateStorefront(["storefront"]);
    res.json({ success: true, stock: r.stock });
};

// GET /api/admin/products/:id/stock-movements?page&limit
export const listMovements = async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const filter = { product: new mongoose.Types.ObjectId(req.params.id) };
    const [movements, total] = await Promise.all([
        StockMovement.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("by", "name email").lean(),
        StockMovement.countDocuments(filter),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, movements, total, totalPages: Math.ceil(total / limit), currentPage: page });
};
