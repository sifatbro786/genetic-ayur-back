// services/publicShape.js
// What the storefront is allowed to see. Raw stock counts stay private
// (competitors and resellers read them); each pack instead says how many the
// form may offer, which is all the UI needs for its quantity stepper and the
// "stock out" state.
import { bkashConfigured, sslcommerzConfigured } from "../config/env.js";
import { resolveMethods } from "./paymentMethods.js";
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
        description: p.description || "",
        image: p.image,
        gallery: p.gallery || [],
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
    // `methods` is the truth for the order form: what is on in the dashboard
    // AND reachable (a gateway with no keys in .env is left out).
    const methods = resolveMethods(pay, { bkash: bkashConfigured(), sslcommerz: sslcommerzConfigured() });
    const wallet = (w, method) => {
        const m = methods.find((x) => x.method === method);
        if (!m) return { enabled: false };
        // Gateway mode: the shopper pays inside bKash, so no number is shown.
        if (m.flow === "gateway") return { enabled: true, mode: "gateway" };
        return { enabled: true, mode: "manual", number: w.number, accountType: w.accountType, instructions: w.instructions };
    };
    const online = methods.find((x) => x.method === "Online");
    site.payment = {
        methods,
        cod: { enabled: methods.some((x) => x.method === "COD") },
        bkash: wallet(pay.bkash || {}, "bKash"),
        nagad: wallet(pay.nagad || {}, "Nagad"),
        online: online ? { enabled: true, label: pay.online?.label || "" } : { enabled: false },
        codAdvance: pay.codAdvance || "none",
    };
    return site;
};

// What a shopper holding the guest token may see about their order. No admin
// notes, no internal ids, no gateway internals beyond what helps them.
export const toPublicOrder = (o) => ({
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    payNowVia: o.payNowVia?.method ? { method: o.payNowVia.method, flow: o.payNowVia.flow } : null,
    items: (o.orderItems || []).map((i) => ({
        slug: i.slug,
        name: i.name,
        nameBn: i.nameBn,
        image: i.image,
        options: (i.variant?.options || []).map(({ name, value }) => ({ name, value })),
        quantity: i.quantity,
        price: i.price,
        lineTotal: i.lineTotal,
    })),
    itemsPrice: o.itemsPrice,
    shippingPrice: o.shippingPrice,
    totalPrice: o.totalPrice,
    savings: o.savings || 0,
    payNow: o.payNow,
    payOnDelivery: o.payOnDelivery,
    amountPaid: o.amountPaid || 0,
    shippingAddress: {
        name: o.shippingAddress?.name,
        phone: o.shippingAddress?.phone,
        addressLine1: o.shippingAddress?.addressLine1,
        locationLabel: o.shippingAddress?.locationLabel,
    },
    customerNote: o.customerNote || "",
    manualPayment: o.manualPayment
        ? {
              method: o.manualPayment.method,
              trxId: o.manualPayment.trxId,
              // Shown so the shopper can fix a wrong TrxID and resubmit.
              rejectReason: o.paymentStatus === "Failed" ? o.manualPayment.rejectReason || "" : "",
          }
        : null,
    canRetryPayment: o.payNow > 0 && o.payNowVia?.flow === "gateway" && o.orderStatus !== "Cancelled" && ["Pending", "Failed"].includes(o.paymentStatus),
    canResubmitTrxId: o.payNowVia?.flow === "manual" && o.paymentStatus === "Failed" && o.orderStatus !== "Cancelled",
    statusHistory: (o.statusHistory || []).map((h) => ({ status: h.status, updatedAt: h.updatedAt })),
});

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
