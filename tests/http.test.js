// HTTP layer checks that run before any database access: validation,
// operator injection, CORS, unknown routes. No MongoDB needed.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.MONGODB_URI = "mongodb://127.0.0.1:1/never-connected";

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
