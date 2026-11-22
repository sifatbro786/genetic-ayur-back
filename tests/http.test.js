// HTTP layer checks that run before any database access: validation,
// operator injection, CORS, unknown routes. No MongoDB needed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.MONGODB_URI = "mongodb://127.0.0.1:1/never-connected";
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "ga-uploads-"));
process.env.UPLOAD_DIR = uploadDir;

let server, base;
before(async () => {
    const app = (await import("../app.js")).default;
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const post = (path, body, headers = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

test("operator injection in login is rejected before the database", async () => {
    const res = await post("/api/admin/auth/login", JSON.stringify({ email: { $gt: "" }, password: { $gt: "" } }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).success, false);
});

test("calculate validates items, quantity cap and zone", async () => {
    const item = { slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: 11 };
    let res = await post("/api/checkout/calculate", JSON.stringify({ items: [item], zone: "dhaka_inside" }));
    let body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.errors[0].field, "items[0].quantity");
    res = await post("/api/checkout/calculate", JSON.stringify({ items: [{ ...item, quantity: 1 }], zone: "mars" }));
    assert.equal(res.status, 400);
    res = await post("/api/checkout/calculate", JSON.stringify({ items: [], zone: "dhaka_inside" }));
    assert.equal(res.status, 400);
    res = await post("/api/checkout/calculate", JSON.stringify({ items: [{ ...item, slug: { $ne: 1 }, quantity: 1 }], zone: "dhaka_inside" }));
    assert.equal(res.status, 400);
});

test("malformed JSON is a 400, not a 500", async () => {
    const res = await post("/api/checkout/calculate", "{not json");
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, "Request body is not valid JSON");
});

test("a browser on another site is refused; the allowed dev origin passes CORS", async () => {
    let res = await fetch(`${base}/api/nothing`, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
    res = await fetch(`${base}/api/nothing`, { headers: { Origin: "http://localhost:3000" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.equal(res.status, 404);
});

test("admin routes need a token; a forged token is refused", async () => {
    assert.equal((await fetch(`${base}/api/admin/auth/me`)).status, 401);
    const forged = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIiwidiI6MH0.";
    const res = await fetch(`${base}/api/admin/auth/me`, { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(res.status, 401);
});

test("security headers are set and x-powered-by is gone", async () => {
    const res = await fetch(`${base}/api/nothing`);
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.ok(res.headers.get("content-security-policy"));
});

const order = (over = {}) => ({
    items: [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: 1 }],
    zone: "dhaka_inside",
    name: "Test Buyer",
    phone: "01712345678",
    address: "House 1, Road 2, Mirpur, Dhaka",
    ...over,
});

test("order validation: phone, address, TrxID format", async () => {
    let res = await post("/api/orders", JSON.stringify(order({ phone: "12345" })));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).errors[0].field, "phone");
    res = await post("/api/orders", JSON.stringify(order({ address: "short" })));
    assert.equal(res.status, 400);
    res = await post("/api/orders", JSON.stringify(order({ trxId: "<script>" })));
    assert.equal(res.status, 400);
    res = await post("/api/orders", JSON.stringify(order({ phone: { $ne: "" } })));
    assert.equal(res.status, 400);
});

test("honeypot is refused before the database", async () => {
    const res = await post("/api/orders", JSON.stringify(order({ website: "http://spam" })));
    assert.equal(res.status, 400);
});

test("order lookup rejects a malformed order number", async () => {
    const res = await fetch(`${base}/api/orders/..%2Fadmin`, { headers: { "X-Order-Token": "x" } });
    assert.equal(res.status, 400);
});

test("guest token header passes the CORS preflight", async () => {
    const res = await fetch(`${base}/api/orders/GA261122001`, {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-order-token" },
    });
    assert.equal(res.status, 204);
    assert.match(res.headers.get("access-control-allow-headers") || "", /X-Order-Token/i);
});

test("gateway fail/cancel posts are not blocked by CORS and redirect to the storefront", async () => {
    const res = await fetch(`${base}/api/payments/sslcommerz/cancel`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://sandbox.sslcommerz.com" },
        body: "tran_id=GA261122001-1&status=CANCELLED",
    });
    assert.equal(res.status, 303);
    assert.match(res.headers.get("location"), /\/order\/GA261122001\?payment=cancelled$/);
});

test("admin order routes need a token", async () => {
    assert.equal((await fetch(`${base}/api/admin/orders`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/customers`)).status, 401);
});

test("phase 3 admin routes need a token; an anonymous upload is refused before buffering", async () => {
    for (const p of ["/api/admin/site", "/api/admin/landing", "/api/admin/products"]) {
        assert.equal((await fetch(base + p)).status, 401, p);
    }
    const form = new FormData();
    form.append("image", new Blob([Buffer.alloc(1024)], { type: "image/png" }), "a.png");
    const res = await fetch(`${base}/api/admin/uploads`, { method: "POST", body: form });
    assert.equal(res.status, 401);
});

test("uploads are served cross-origin with a long cache, no listing, no dotfiles", async () => {
    fs.mkdirSync(path.join(uploadDir, "2026", "11"), { recursive: true });
    fs.writeFileSync(path.join(uploadDir, "2026", "11", "abc.webp"), "x");
    fs.writeFileSync(path.join(uploadDir, ".env"), "SECRET=1");
    let res = await fetch(`${base}/uploads/2026/11/abc.webp`, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(res.headers.get("cache-control"), /max-age=31536000.*immutable/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    res = await fetch(`${base}/uploads/2026/11/`);
    assert.equal(res.status, 404);
    res = await fetch(`${base}/uploads/.env`);
    assert.notEqual(res.status, 200);
    res = await fetch(`${base}/uploads/..%2f..%2fpackage.json`);
    assert.notEqual(res.status, 200);
});
