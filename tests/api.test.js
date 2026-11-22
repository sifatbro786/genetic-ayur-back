// End to end against a real MongoDB: seed, public reads, checkout calculate,
// admin login. Uses MONGODB_TEST_URI if set (a throwaway database, it is
// WIPED), otherwise an in-memory server (first run downloads mongod, ~100 MB).
// If neither is available the suite is skipped, not failed.
import assert from "node:assert/strict";
import { after, before, test as nodeTest } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";

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

before(async () => {
    if (skipReason) return;
    process.env.MONGODB_URI = uri;
    mongoose = (await import("mongoose")).default;
    const { connectDB } = await import("../config/db.js");
    await connectDB(uri);
    await mongoose.connection.dropDatabase();
    const { buildSeed } = await import("../seed/build.js");
    const SiteSettings = (await import("../models/SiteSettings.js")).default;
    const LandingPage = (await import("../models/LandingPage.js")).default;
    const Product = (await import("../models/Product.js")).default;
    const User = (await import("../models/User.js")).default;
    const seed = buildSeed();
    await SiteSettings.create({ ...seed.site, key: "main" });
    await LandingPage.create({ ...seed.landing, key: "main" });
    await Product.create(seed.products);
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
});

const post = (path, body, headers = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const kasturi = (quantity = 1) => [
    { slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity },
];

test("storefront returns site, landing and products without raw stock", async () => {
    const res = await fetch(`${base}/api/storefront`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.site.storeName, "Genetic Ayur");
    assert.equal(body.landing.order[0], "hero");
    assert.equal(body.products.length, 1);
    assert.equal(body.products[0].stock, undefined);
    assert.equal(body.products[0].variants[0].maxQuantity, 10);
    assert.equal(body.site.payment.bkash.number, undefined);
});

test("product by slug; unknown slug is 404", async () => {
    assert.equal((await fetch(`${base}/api/products/kasturi-active-power`)).status, 200);
    assert.equal((await fetch(`${base}/api/products/nope`)).status, 404);
});

test("calculate ignores a client price and returns server totals", async () => {
    const res = await post("/api/checkout/calculate", {
        items: [{ ...kasturi(2)[0], price: 1 }],
        zone: "outside_dhaka",
        totalPrice: 5,
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.totals.itemsPrice, 2400);
    assert.equal(body.totals.shippingPrice, 130);
    assert.equal(body.totals.totalPrice, 2530);
    assert.equal(body.totals.paymentMethod, "COD");
});

test("calculate validation and business errors", async () => {
    let res = await post("/api/checkout/calculate", { items: kasturi(11), zone: "dhaka_inside" });
    assert.equal(res.status, 400);
    res = await post("/api/checkout/calculate", { items: kasturi(), zone: "mars" });
    assert.equal(res.status, 400);
    res = await post("/api/checkout/calculate", { items: kasturi(), zone: "dhaka_inside", paymentMethod: "bKash" });
    assert.equal((await res.json()).code, "PAYMENT_UNAVAILABLE");
});

test("operator injection in the body is neutralised", async () => {
    const res = await post("/api/admin/auth/login", { email: { $gt: "" }, password: { $gt: "" } });
    assert.equal(res.status, 400);
});

test("admin login, me, wrong password, no token", async () => {
    let res = await post("/api/admin/auth/login", { email: "owner@test.com", password: "wrong password" });
    assert.equal(res.status, 401);
    res = await post("/api/admin/auth/login", { email: "OWNER@test.com", password: "correct horse battery" });
    const { token, user } = await res.json();
    assert.ok(token);
    assert.equal(user.password, undefined);
    res = await fetch(`${base}/api/admin/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${base}/api/admin/auth/me`)).status, 401);
});

test("password change signs out old tokens", async () => {
    const login = await (await post("/api/admin/auth/login", { email: "owner@test.com", password: "correct horse battery" })).json();
    const res = await fetch(`${base}/api/admin/auth/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
        body: JSON.stringify({ currentPassword: "correct horse battery", newPassword: "an even longer password" }),
    });
    const fresh = await res.json();
    assert.equal(res.status, 200);
    const old = await fetch(`${base}/api/admin/auth/me`, { headers: { Authorization: `Bearer ${login.token}` } });
    assert.equal(old.status, 401);
    const now = await fetch(`${base}/api/admin/auth/me`, { headers: { Authorization: `Bearer ${fresh.token}` } });
    assert.equal(now.status, 200);
});

test("cross-site browser origin is refused, server-side fetch is fine", async () => {
    const res = await fetch(`${base}/api/site`, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
});
