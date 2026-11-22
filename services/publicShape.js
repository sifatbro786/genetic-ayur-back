// services/publicShape.js
// What the storefront is allowed to see. Raw stock counts stay private
// (competitors and resellers read them); each pack instead says how many the
// form may offer, which is all the UI needs for its quantity stepper and the
// "stock out" state.
import { MAX_QTY_PER_LINE } from "./pricing.js";

export const toPublicProduct = (p) => {
    const stock = p.stock || 0;
    const variants = (p.variants || []).map((v) => {
        const maxQuantity = Math.min(MAX_QTY_PER_LINE, Math.floor(stock / (v.units || 1)));
        return {
            options: v.options.map(({ name, value }) => ({ name, value })),
            note: v.note || "",
            price: v.price,
            comparePrice: v.comparePrice || 0,
            freeShipping: Boolean(v.freeShipping),
            isPopular: Boolean(v.isPopular),
            units: v.units || 1,
            maxQuantity,
            inStock: maxQuantity > 0,
        };
    });
    return {
        name: p.name,
        nameBn: p.nameBn,
        slug: p.slug,
        shortDescription: p.shortDescription || "",
        image: p.image,
        netWeight: p.netWeight,
        sortOrder: p.sortOrder || 0,
        inStock: variants.some((v) => v.inStock),
        variants,
    };
};

const strip = ({ _id, __v, key, createdAt, ...rest }) => rest;

export const toPublicSite = (s) => {
    const site = strip(s);
    // Disabled wallets are dropped entirely so an old number left in the
    // dashboard is never shown to shoppers.
    const pay = site.payment || {};
    site.payment = {
        cod: { enabled: Boolean(pay.cod?.enabled) },
        bkash: pay.bkash?.enabled ? pay.bkash : { enabled: false },
        nagad: pay.nagad?.enabled ? pay.nagad : { enabled: false },
        codAdvance: pay.codAdvance || "none",
    };
    return site;
};

export const toPublicLanding = (l) => {
    const landing = strip(l);
    // Hidden sections are not sent at all: a disabled section may hold
    // unfinished copy the owner has not approved yet.
    const sections = {};
    for (const [k, v] of Object.entries(landing.sections || {})) {
        if (v && v.enabled !== false) sections[k] = v;
    }
    return { ...landing, order: (landing.order || []).filter((k) => sections[k]), sections };
};
