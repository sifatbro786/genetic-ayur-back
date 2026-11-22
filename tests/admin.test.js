// Phase 3 end to end: settings, landing page, products, stock ledger and
// image upload through the dashboard API. Needs MongoDB like api.test.js
// (MONGODB_TEST_URI = a THROWAWAY database, it is WIPED, or in-memory).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test as nodeTest } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import sharp from "sharp";

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "ga-admin-uploads-"));
Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
    UPLOAD_DIR: uploadDir,
    API_PUBLIC_URL: "https://api.test",
    // No gateway keys and no mail in this suite.
    BKASH_APP_KEY: "",
    SSLCZ_STORE_ID: "",
    SMTP_PASS: "",
    REVALIDATE_URL: "",
});

let mongo, base, server, mongoose, skipReason;
let uri = process.env.MONGODB_TEST_URI;
if (!uri) {
    try {
        mongo = await MongoMemoryServer.create();
        uri = mongo.getUri();
    } catch (err) {
        skipReason = `no MongoDB available (${err.message.split("\n")[0]})`;
    }
}
const test = (name, fn) => nodeTest(name, { skip: skipReason }, fn);

let Product, StockMovement, token, kasturiId;

before(async () => {
    if (skipReason) return;
    mongoose = (await import("mongoose")).default;
    const { connectDB } = await import("../config/db.js");
    await connectDB(uri);
    await mongoose.connection.dropDatabase();
    const { buildSeed } = await import("../seed/build.js");
    const SiteSettings = (await import("../models/SiteSettings.js")).default;
    const LandingPage = (await import("../models/LandingPage.js")).default;
    Product = (await import("../models/Product.js")).default;
    StockMovement = (await import("../models/StockMovement.js")).default;
    const User = (await import("../models/User.js")).default;
    const seed = buildSeed();
    await SiteSettings.create({ ...seed.site, key: "main" });
    await LandingPage.create({ ...seed.landing, key: "main" });
    const [p] = await Product.create(seed.products);
    kasturiId = String(p._id);
    await User.create({ email: "owner@test.com", password: "correct horse battery" });
    const app = (await import("../app.js")).default;
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server?.close();
    if (mongoose?.connection.readyState === 1) await mongoose.connection.dropDatabase();
    await mongoose?.connection.close();
    await mongo?.stop();
    fs.rmSync(uploadDir, { recursive: true, force: true });
});

const call = (method, p, body) =>
    fetch(base + p, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
const j = async (res) => ({ status: res.status, body: await res.json() });

test("login", async () => {
    const res = await fetch(`${base}/api/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@test.com", password: "correct horse battery" }),
    });
    token = (await res.json()).token;
    assert.ok(token);
});

test("site: partial nested update keeps siblings; wallet number normalised and public", async () => {
    let r = await j(await call("GET", "/api/admin/site"));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.gateways, { bkash: false, sslcommerz: false });
    const enabledBefore = r.body.site.announcement.enabled;

    r = await j(await call("PUT", "/api/admin/site", { announcement: { text: "নতুন ঘোষণা" }, key: "hacked", payment: { bkash: { enabled: true, number: "+880 1712-345678" } } }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.site.announcement.text, "নতুন ঘোষণা");
    assert.equal(r.body.site.announcement.enabled, enabledBefore);
    assert.equal(r.body.site.key, "main");
    assert.equal(r.body.site.payment.bkash.number, "01712345678");
    assert.equal(r.body.site.payment.cod.enabled, true);

    const pub = await (await fetch(`${base}/api/site`)).json();
    assert.equal(pub.site.payment.bkash.number, "01712345678");
    assert.ok(pub.site.payment.methods.some((m) => m.method === "bKash" && m.flow === "manual"));
});

test("site: model rules reject bad values; gateway without keys warns and hides", async () => {
    let r = await j(await call("PUT", "/api/admin/site", { payment: { nagad: { enabled: true, number: "123" } } }));
    assert.equal(r.status, 400);
    r = await j(await call("PUT", "/api/admin/site", { logo: "javascript:alert(1)" }));
    assert.equal(r.status, 400);
    r = await j(await call("PUT", "/api/admin/site", { payment: { cod: { enabled: false }, bkash: { enabled: false } } }));
    assert.equal(r.status, 400);
    r = await j(await call("PUT", "/api/admin/site", { payment: { bkash: { mode: "gateway" } } }));
    assert.equal(r.status, 200);
    assert.equal(r.body.warnings.length, 1);
    const pub = await (await fetch(`${base}/api/site`)).json();
    assert.equal(pub.site.payment.bkash.enabled, false);
    await call("PUT", "/api/admin/site", { payment: { bkash: { mode: "manual" } } });
});

test("landing: sections cleaned, bad input refused, hidden sections leave the public page", async () => {
    let r = await j(await call("PUT", "/api/admin/landing", { sections: { faq: { title: "  প্রশ্ন ", items: [{ q: "Q?", a: "A.", html: "<script>" }] } } }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.landing.sections.faq.title, "প্রশ্ন");
    assert.equal(r.body.landing.sections.faq.items[0].html, undefined);
    assert.ok(r.body.landing.sections.hero.title, "other sections untouched");

    r = await j(await call("PUT", "/api/admin/landing", { sections: { benefits: { image: "data:image/png;base64,AA" } } }));
    assert.equal(r.status, 400);
    r = await j(await call("PUT", "/api/admin/landing", { order: ["hero", "mars"] }));
    assert.equal(r.status, 400);
    r = await j(await call("PUT", "/api/admin/landing", { order: ["hero", "hero"] }));
    assert.equal(r.status, 400);
    r = await j(await call("PUT", "/api/admin/landing", { productSlug: "does-not-exist" }));
    assert.equal(r.status, 400);

    r = await j(await call("PUT", "/api/admin/landing", { sections: { reviews: { enabled: false, title: "draft" } } }));
    assert.equal(r.status, 200);
    const pub = await (await fetch(`${base}/api/landing`)).json();
    assert.equal(pub.landing.sections.reviews, undefined);
    assert.ok(!pub.landing.order.includes("reviews"));
    const full = await j(await call("GET", "/api/admin/landing"));
    assert.equal(full.body.landing.sections.reviews.title, "draft");
});

let otherId;
const pack = (value, price, extra = {}) => ({ options: [{ name: "প্যাক", value }], price, ...extra });

test("products: create with opening stock, auto slug, duplicate slug refused", async () => {
    let r = await j(await call("POST", "/api/admin/products", { name: "Ashwagandha Gold", nameBn: "অশ্বগন্ধা গোল্ড", variants: [pack("১ কৌটা", 900)], stock: 50 }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.product.slug, "ashwagandha-gold");
    assert.equal(r.body.product.stock, 50);
    otherId = r.body.product._id;
    const ledger = await StockMovement.find({ product: otherId }).lean();
    assert.deepEqual(ledger.map((m) => [m.reason, m.change, m.balanceAfter]), [["initial", 50, 50]]);

    r = await j(await call("POST", "/api/admin/products", { name: "Ashwagandha Gold", nameBn: "x", variants: [pack("১", 1)] }));
    assert.equal(r.status, 409);
    r = await j(await call("POST", "/api/admin/products", { name: "Dup packs", nameBn: "x", variants: [pack("১", 1), pack(" ১ ", 2)] }));
    assert.equal(r.status, 400);
    r = await j(await call("POST", "/api/admin/products", { name: "Bad price", nameBn: "x", variants: [pack("১", 9.5)] }));
    assert.equal(r.status, 400);
});

test("products: edits never touch stock; new price reaches checkout", async () => {
    const r = await j(await call("PUT", `/api/admin/products/${otherId}`, { stock: 9999, variants: [pack("১ কৌটা", 950, { units: 1 })] }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.product.stock, 50);
    const calc = await (
        await fetch(`${base}/api/checkout/calculate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: [{ slug: "ashwagandha-gold", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: 1 }], zone: "dhaka_inside" }),
        })
    ).json();
    assert.equal(calc.totals.itemsPrice, 950);
});

test("products: the landing product cannot be hidden; others soft delete", async () => {
    let r = await j(await call("PUT", `/api/admin/products/${kasturiId}`, { isActive: false }));
    assert.equal(r.status, 409);
    r = await j(await call("DELETE", `/api/admin/products/${kasturiId}`));
    assert.equal(r.status, 409);
    r = await j(await call("DELETE", `/api/admin/products/${otherId}`));
    assert.equal(r.status, 200);
    assert.equal((await fetch(`${base}/api/products/ashwagandha-gold`)).status, 404);
    assert.equal((await Product.findById(otherId).lean()).isActive, false);
    await call("PUT", `/api/admin/products/${otherId}`, { isActive: true });
});

test("products: renaming the landing product's slug moves the landing pointer", async () => {
    let r = await j(await call("PUT", `/api/admin/products/${kasturiId}`, { slug: "Kasturi Active Power 2" }));
    assert.equal(r.status, 200);
    assert.equal(r.body.product.slug, "kasturi-active-power-2");
    const landing = await j(await call("GET", "/api/admin/landing"));
    assert.equal(landing.body.landing.productSlug, "kasturi-active-power-2");
    await call("PUT", `/api/admin/products/${kasturiId}`, { slug: "kasturi-active-power" });
});

test("stock: restock, damaged, never below zero, ledger in order", async () => {
    let r = await j(await call("POST", `/api/admin/products/${otherId}/stock`, { change: 10, reason: "restock", note: "new batch" }));
    assert.equal(r.body.stock, 60);
    r = await j(await call("POST", `/api/admin/products/${otherId}/stock`, { change: -5, reason: "damaged" }));
    assert.equal(r.body.stock, 55);
    r = await j(await call("POST", `/api/admin/products/${otherId}/stock`, { change: 5, reason: "damaged" }));
    assert.equal(r.status, 400);
    r = await j(await call("POST", `/api/admin/products/${otherId}/stock`, { change: -1000, reason: "correction" }));
    assert.equal(r.status, 409);
    r = await j(await call("POST", `/api/admin/products/${otherId}/stock`, { change: 0, reason: "correction" }));
    assert.equal(r.status, 400);
    r = await j(await call("GET", `/api/admin/products/${otherId}/stock-movements`));
    assert.deepEqual(r.body.movements.map((m) => [m.reason, m.change, m.balanceAfter]), [
        ["damaged", -5, 55],
        ["restock", 10, 60],
        ["initial", 50, 50],
    ]);
    assert.equal(r.body.movements[0].by.email, "owner@test.com");
});

test("products: list pages and searches 20+ products", async () => {
    await Product.insertMany(
        Array.from({ length: 21 }, (_, i) => ({ name: `Herb ${i}`, nameBn: `ভেষজ ${i}`, slug: `herb-${i}`, variants: [pack("১", 100)], sortOrder: 10 + i })),
    );
    let r = await j(await call("GET", "/api/admin/products?limit=10&page=3"));
    assert.equal(r.body.total, 23);
    assert.equal(r.body.totalPages, 3);
    assert.equal(r.body.products.length, 3);
    assert.equal(r.body.products[0].stock !== undefined, true);
    r = await j(await call("GET", "/api/admin/products?q=ভেষজ 1"));
    assert.ok(r.body.products.length >= 1);
    const pub = await (await fetch(`${base}/api/products`)).json();
    assert.equal(pub.products.length, 23);
});

test("upload: image is re-encoded to WebP and served; junk refused", async () => {
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 4, background: "#2f5d3a" } }).png().toBuffer();
    const form = new FormData();
    form.append("kind", "product");
    form.append("image", new Blob([png], { type: "image/png" }), "jar.png");
    let res = await fetch(`${base}/api/admin/uploads`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.match(body.url, /^https:\/\/api\.test\/uploads\/\d{4}\/\d{2}\/[a-f0-9]{24}\.webp$/);
    assert.equal(body.width, 1400);
    const local = new URL(body.url).pathname;
    res = await fetch(base + local);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");

    const fake = new FormData();
    fake.append("image", new Blob([Buffer.from("<?php echo 1; ?>")], { type: "image/png" }), "x.png");
    res = await fetch(`${base}/api/admin/uploads`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fake });
    assert.equal(res.status, 400);
    const svg = new FormData();
    svg.append("image", new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg");
    res = await fetch(`${base}/api/admin/uploads`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: svg });
    assert.equal(res.status, 400);
    res = await fetch(`${base}/api/admin/uploads`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: new FormData() });
    assert.equal(res.status, 400);

    // The uploaded URL is accepted as a product image.
    const r = await j(await call("PUT", `/api/admin/products/${otherId}`, { image: body.url, gallery: [body.url] }));
    assert.equal(r.status, 200);
});
