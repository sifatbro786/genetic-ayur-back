// seed/build.js
// Turns the storefront defaults into database documents. Kept separate from
// scripts/seed.js so the tests seed an in-memory database the same way.
import { defaultLanding, defaultProduct, defaultSite } from "./defaults.js";

export const buildSeed = () => {
    const site = structuredClone(defaultSite);
    // Not in the storefront defaults yet (the static demo was COD only).
    // bKash/Nagad stay off until the owner enters the numbers in Settings;
    // online (SSLCommerz) stays off until its keys are in .env.
    site.payment = {
        cod: { enabled: true },
        bkash: { enabled: false, mode: "manual", number: "", accountType: "personal", instructions: "" },
        nagad: { enabled: false, mode: "manual", number: "", accountType: "personal", instructions: "" },
        online: { enabled: false, label: "কার্ড / মোবাইল ব্যাংকিং" },
        codAdvance: "none",
    };

    const product = structuredClone(defaultProduct);
    product.sortOrder = 0;
    product.shortDescription = "";
    product.variants = product.variants.map((v) => ({ units: 1, ...v }));

    const landing = { ...structuredClone(defaultLanding), productSlug: product.slug };

    return { site, landing, products: [product] };
};
