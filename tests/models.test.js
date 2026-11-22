// Schema validation runs without a database connection, so these check the
// real models: the seed must be valid, and the money related rules hold.
import assert from "node:assert/strict";
import { test } from "node:test";
import LandingPage from "../models/LandingPage.js";
import Product from "../models/Product.js";
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
