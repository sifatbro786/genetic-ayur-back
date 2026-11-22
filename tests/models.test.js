// Schema validation runs without a database connection, so these check the
// real models: the seed must be valid, and the money related rules hold.
import assert from "node:assert/strict";
import { test } from "node:test";
import LandingPage from "../models/LandingPage.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import SiteSettings from "../models/SiteSettings.js";
import { buildSeed } from "../seed/build.js";

const seed = buildSeed();
const rejects = (doc, path) =>
    assert.rejects(doc.validate(), (err) => {
        assert.ok(err.errors[path], `expected an error on ${path}, got ${Object.keys(err.errors)}`);
        return true;
    });

test("the seed passes every model", async () => {
    await new SiteSettings(seed.site).validate();
    await new LandingPage(seed.landing).validate();
    for (const p of seed.products) await new Product(p).validate();
});

test("two packs with the same options are refused", async () => {
    const p = structuredClone(seed.products[0]);
    p.variants.push({ ...p.variants[0], options: [{ name: " প্যাক ", value: "১ কৌটা" }], price: 1 });
    await rejects(new Product(p), "variants");
});

test("slug format and whole number stock", async () => {
    await rejects(new Product({ ...seed.products[0], slug: "Bad Slug!" }), "slug");
    await rejects(new Product({ ...seed.products[0], stock: 1.5 }), "stock");
});

test("compare price at or below the price is cleared", async () => {
    const doc = new Product({ ...seed.products[0], variants: [{ ...seed.products[0].variants[0], comparePrice: 1000 }] });
    await doc.validate();
    assert.equal(doc.variants[0].comparePrice, 0);
});

test("wallet needs a valid number, stored normalised", async () => {
    const s = structuredClone(seed.site);
    s.payment.bkash = { enabled: true, number: "12345" };
    await rejects(new SiteSettings(s), "payment.bkash.number");
    s.payment.bkash.number = "+880 1903-041454";
    const doc = new SiteSettings(s);
    await doc.validate();
    assert.equal(doc.payment.bkash.number, "01903041454");
});

test("advance needs a wallet; at least one method must be on; zones unique", async () => {
    const s = structuredClone(seed.site);
    s.payment.codAdvance = "delivery";
    await rejects(new SiteSettings(s), "payment.codAdvance");
    const t = structuredClone(seed.site);
    t.payment.cod.enabled = false;
    await rejects(new SiteSettings(t), "payment");
    const u = structuredClone(seed.site);
    u.shipping.push({ ...u.shipping[0] });
    await rejects(new SiteSettings(u), "shipping");
});

test("landing order rejects unknown and repeated sections", async () => {
    await rejects(new LandingPage({ ...seed.landing, order: ["hero", "popup"] }), "order.1");
    await rejects(new LandingPage({ ...seed.landing, order: ["hero", "hero"] }), "order");
});

test("bKash in gateway mode needs no number; Nagad cannot be a gateway", async () => {
    const s = structuredClone(seed.site);
    s.payment.bkash = { enabled: true, mode: "gateway", number: "" };
    await new SiteSettings(s).validate();
    s.payment.nagad = { enabled: true, mode: "gateway", number: "01712345678" };
    await rejects(new SiteSettings(s), "payment.nagad.mode");
});

test("online payment counts as a prepaid method for the COD advance", async () => {
    const s = structuredClone(seed.site);
    s.payment.codAdvance = "delivery";
    await rejects(new SiteSettings(s), "payment.codAdvance");
    s.payment.online = { enabled: true };
    await new SiteSettings(s).validate();
});

test("order refuses a bad phone, unknown status and empty items", async () => {
    const base = {
        orderNumber: "GA261122001",
        orderItems: [{ slug: "x", name: "x", quantity: 1, units: 1, price: 10, lineTotal: 10 }],
        shippingAddress: { name: "Test", phone: "01712345678", addressLine1: "House 1, Road 2, Dhaka", locationType: "dhaka_inside" },
        paymentMethod: "COD",
        itemsPrice: 10,
        shippingPrice: 70,
        totalPrice: 80,
        payNow: 0,
        payOnDelivery: 80,
        guestAccessTokenHash: "a".repeat(64),
    };
    await new Order(base).validate();
    await rejects(new Order({ ...base, shippingAddress: { ...base.shippingAddress, phone: "12345" } }), "shippingAddress.phone");
    await rejects(new Order({ ...base, orderStatus: "Lost" }), "orderStatus");
    await rejects(new Order({ ...base, orderItems: [] }), "orderItems");
});
