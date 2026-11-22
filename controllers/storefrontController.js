// controllers/storefrontController.js
// Public, read only. Every response is { success: true, <name> }.
import LandingPage from "../models/LandingPage.js";
import Product from "../models/Product.js";
import SiteSettings from "../models/SiteSettings.js";
import { toPublicLanding, toPublicProduct, toPublicSite } from "../services/publicShape.js";

// Short shared cache: CDNs and the Next.js fetch cache can serve repeats, and
// a dashboard edit still shows up within a minute without any purge call.
const cachePublic = (res) => res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=120");

const notSeeded = (res) =>
    res.status(503).json({ success: false, message: "Store content is not set up yet. Run npm run seed." });

const activeProducts = () => Product.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();

// GET /api/storefront — everything the landing page needs in one round trip,
// for server rendering. The three pieces are also available separately.
export const getStorefront = async (_req, res) => {
    const [site, landing, products] = await Promise.all([
        SiteSettings.getMain().lean(),
        LandingPage.getMain().lean(),
        activeProducts(),
    ]);
    if (!site || !landing) return notSeeded(res);
    cachePublic(res);
    res.json({
        success: true,
        site: toPublicSite(site),
        landing: toPublicLanding(landing),
        products: products.map(toPublicProduct),
    });
};

// GET /api/site
export const getSite = async (_req, res) => {
    const site = await SiteSettings.getMain().lean();
    if (!site) return notSeeded(res);
    cachePublic(res);
    res.json({ success: true, site: toPublicSite(site) });
};

// GET /api/landing
export const getLanding = async (_req, res) => {
    const landing = await LandingPage.getMain().lean();
    if (!landing) return notSeeded(res);
    cachePublic(res);
    res.json({ success: true, landing: toPublicLanding(landing) });
};

// GET /api/products
export const getProducts = async (_req, res) => {
    const products = await activeProducts();
    cachePublic(res);
    res.json({ success: true, products: products.map(toPublicProduct) });
};

// GET /api/products/:slug — inactive products answer 404, same as missing,
// so a hidden product cannot be probed.
export const getProductBySlug = async (req, res) => {
    const product = await Product.findOne({ slug: String(req.params.slug).toLowerCase(), isActive: true }).lean();
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    cachePublic(res);
    res.json({ success: true, product: toPublicProduct(product) });
};
