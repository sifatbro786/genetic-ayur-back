// Phase 2 end to end: orders, manual wallet payments, admin workflow, stock,
// and both gateways against a fake fetch (no real bKash/SSLCommerz calls).
// Needs MongoDB like api.test.js: MONGODB_TEST_URI (a THROWAWAY database,
// it is WIPED) or an in-memory server. Skipped, not failed, without one.
import assert from "node:assert/strict";
import { after, before, test as nodeTest } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
// Fake gateway keys so both gateways count as configured; the fetch seam
// below answers for them. SMTP_PASS empty: tests never send mail.
Object.assign(process.env, {
    BKASH_APP_KEY: "k",
    BKASH_APP_SECRET: "s",
    BKASH_USERNAME: "u",
    BKASH_PASSWORD: "p",
    BKASH_BASE_URL: "https://bkash.test/v1.2.0-beta",
    SSLCZ_STORE_ID: "store",
    SSLCZ_STORE_PASSWORD: "secret",
    SMTP_PASS: "",
    STOREFRONT_URL: "https://shop.test",
    API_PUBLIC_URL: "https://api.test",
    STOCK_DEDUCT_ON: "confirmed",
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

let SiteSettings, Product, Order, Customer, adminToken;

// What the fake gateways answer. Tests change these fields.
const gw = { sslAmount: null, sslStatus: "VALID", sslRisk: "0", bkashAmount: null, bkashInvoice: null, bkashStatus: "Completed" };

before(async () => {
    if (skipReason) return;
    mongoose = (await import("mongoose")).default;
    const { connectDB } = await import("../config/db.js");
    await connectDB(uri);
    await mongoose.connection.dropDatabase();
    const { buildSeed } = await import("../seed/build.js");
    SiteSettings = (await import("../models/SiteSettings.js")).default;
    Product = (await import("../models/Product.js")).default;
    Order = (await import("../models/Order.js")).default;
    Customer = (await import("../models/Customer.js")).default;
    const LandingPage = (await import("../models/LandingPage.js")).default;
    const User = (await import("../models/User.js")).default;
    const seed = buildSeed();
    seed.site.payment.bkash = { enabled: true, mode: "manual", number: "01900000000", accountType: "personal" };
    seed.site.payment.online = { enabled: true };
    await SiteSettings.create({ ...seed.site, key: "main" });
    await LandingPage.create({ ...seed.landing, key: "main" });
    await Product.create(seed.products);
    await Order.syncIndexes();
    await User.create({ email: "owner@test.com", password: "correct horse battery" });

    const { setGatewayFetch } = await import("../services/payments/http.js");
    setGatewayFetch(async (url, init = {}) => {
        const u = new URL(url);
        const json = (o) => new Response(JSON.stringify(o), { status: 200 });
        const body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
        if (u.pathname.endsWith("/token/grant")) return json({ id_token: "t", refresh_token: "r", expires_in: 3600 });
        if (u.pathname.endsWith("/checkout/create")) {
            gw.bkashInvoice = body.merchantInvoiceNumber;
            gw.bkashAmount ??= Number(body.amount);
            return json({ statusCode: "0000", paymentID: `PAY-${body.merchantInvoiceNumber}`, bkashURL: "https://pay.bkash.test/x" });
        }
        if (u.pathname.endsWith("/checkout/execute") || u.pathname.endsWith("/payment/status")) {
            return json({ transactionStatus: gw.bkashStatus, trxID: `TRX${body.paymentID.slice(-6)}`, amount: String(gw.bkashAmount), merchantInvoiceNumber: gw.bkashInvoice, paymentID: body.paymentID });
        }
        if (u.pathname === "/gwprocess/v4/api.php") {
            const f = new URLSearchParams(init.body);
            gw.sslTran = f.get("tran_id");
            gw.sslAmountAsked = f.get("total_amount");
            return json({ status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw" });
        }
        if (u.pathname.endsWith("validationserverAPI.php")) {
            return json({ status: gw.sslStatus, tran_id: gw.sslTran, val_id: u.searchParams.get("val_id"), amount: String(gw.sslAmount ?? gw.sslAmountAsked), currency: "BDT", bank_tran_id: `BANK-${u.searchParams.get("val_id")}`, risk_level: gw.sslRisk });
        }
        return new Response("nope", { status: 404 });
    });

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

const json = { "Content-Type": "application/json" };
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });
const patch = (path, body) => fetch(base + path, { method: "PATCH", headers: { ...json, Authorization: `Bearer ${adminToken}` }, body: JSON.stringify(body) });
const adminGet = (path) => fetch(base + path, { headers: { Authorization: `Bearer ${adminToken}` } });

let phoneSeq = 0;
const nextPhone = () => `0171${String(10000000 + ++phoneSeq).slice(1)}`;
const orderBody = (over = {}) => ({
    items: [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: 1 }],
    zone: "dhaka_inside",
    name: "Test Buyer",
    phone: nextPhone(),
    address: "House 1, Road 2, Mirpur, Dhaka",
    ...over,
});
const place = async (over) => {
    const res = await post("/api/orders", orderBody(over));
    return { res, body: await res.json() };
};
const stock = async () => (await Product.findOne({ slug: "kasturi-active-power" }).lean()).stock;

test("admin login for the rest of the suite", async () => {
    const res = await post("/api/admin/auth/login", { email: "owner@test.com", password: "correct horse battery" });
    adminToken = (await res.json()).token;
    assert.ok(adminToken);
});

test("COD order: server totals, token works, wrong token is 404", async () => {
    const { res, body } = await place({ items: [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: 2, price: 1 }], totalPrice: 5 });
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.match(body.orderNumber, /^GA\d{9}$/);
    assert.match(body.guestAccessToken, /^[a-f0-9]{48}$/);
    assert.equal(body.order.totalPrice, 2470);
    assert.equal(body.order.paymentStatus, "Pending");
    assert.equal(body.nextAction, null);
    const doc = await Order.findOne({ orderNumber: body.orderNumber }).select("+guestAccessTokenHash").lean();
    assert.notEqual(doc.guestAccessTokenHash, body.guestAccessToken);
    assert.equal(doc.statusHistory[0].updatedBy, undefined);

    let r = await fetch(`${base}/api/orders/${body.orderNumber}`, { headers: { "X-Order-Token": body.guestAccessToken } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).order.adminNotes, undefined);
    r = await fetch(`${base}/api/orders/${body.orderNumber}`, { headers: { "X-Order-Token": "0".repeat(48) } });
    assert.equal(r.status, 404);
    assert.equal((await fetch(`${base}/api/orders/${body.orderNumber}`)).status, 404);
    assert.equal((await Customer.findOne({ phone: doc.shippingAddress.phone }).lean()).orderCount, 1);
});

test("order numbers are sequential within the day", async () => {
    const a = (await place()).body.orderNumber;
    const b = (await place()).body.orderNumber;
    assert.equal(Number(b.slice(-3)), Number(a.slice(-3)) + 1);
});

test("same clientRequestId returns the first order with a rotated token", async () => {
    const id = "c0ffee00-1111-4222-8333-444455556666";
    const first = await place({ clientRequestId: id });
    const phone = first.body.order.shippingAddress.phone;
    const again = await place({ clientRequestId: id, phone });
    assert.equal(again.res.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.orderNumber, first.body.orderNumber);
    const get = (t) => fetch(`${base}/api/orders/${first.body.orderNumber}`, { headers: { "X-Order-Token": t } });
    assert.equal((await get(again.body.guestAccessToken)).status, 200);
    assert.equal((await get(first.body.guestAccessToken)).status, 404);
    assert.equal(await Order.countDocuments({ "shippingAddress.phone": phone }), 1);
});

test("a phone number is capped at 3 orders an hour", async () => {
    const phone = nextPhone();
    for (let i = 0; i < 3; i++) assert.equal((await place({ phone })).res.status, 201);
    const { res, body } = await place({ phone });
    assert.equal(res.status, 429);
    assert.equal(body.code, "PHONE_LIMIT");
});

let manualOrder;
test("manual bKash: TrxID required, unique, order waits for verification", async () => {
    let r = await place({ paymentMethod: "bKash" });
    assert.equal(r.res.status, 400);
    assert.equal(r.body.code, "TRXID_REQUIRED");
    r = await place({ paymentMethod: "bKash", trxId: "ab12cd34ef", senderNumber: "01811111111" });
    assert.equal(r.res.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.order.paymentStatus, "Verifying");
    assert.equal(r.body.order.payNow, 1270);
    assert.equal(r.body.order.manualPayment.trxId, "AB12CD34EF");
    manualOrder = r.body;
    r = await place({ paymentMethod: "bKash", trxId: "AB12CD34EF", senderNumber: "01811111111" });
    assert.equal(r.res.status, 409);
    assert.equal(r.body.code, "TRXID_USED");
});

test("admin: confirm needs a verified payment; confirm takes stock, cancel returns it", async () => {
    const n = manualOrder.orderNumber;
    let r = await patch(`/api/admin/orders/${n}/status`, { status: "Confirmed" });
    assert.equal(r.status, 409);
    r = await patch(`/api/admin/orders/${n}/payment`, { action: "verify" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).order.paymentStatus, "Paid");
    const before = await stock();
    r = await patch(`/api/admin/orders/${n}/status`, { status: "Confirmed", note: "called the customer" });
    assert.equal(r.status, 200);
    assert.equal(await stock(), before - 1);
    // Confirming twice from two tabs: the second is refused, stock untouched.
    r = await patch(`/api/admin/orders/${n}/status`, { status: "Confirmed" });
    assert.equal(r.status, 409);
    r = await patch(`/api/admin/orders/${n}/status`, { status: "Cancelled" });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.match(body.warning, /Refund/);
    assert.equal(await stock(), before);
    r = await patch(`/api/admin/orders/${n}/payment`, { action: "refunded", reason: "bKash refund 9X8Y" });
    assert.equal((await r.json()).order.paymentStatus, "Refunded");
});

test("rejected TrxID: shopper sees the reason and can resubmit", async () => {
    const { body } = await place({ paymentMethod: "bKash", trxId: "ZZ99YY88XX", senderNumber: "01811111111" });
    const n = body.orderNumber;
    let r = await patch(`/api/admin/orders/${n}/payment`, { action: "reject" });
    assert.equal(r.status, 400);
    r = await patch(`/api/admin/orders/${n}/payment`, { action: "reject", reason: "No such transaction" });
    assert.equal((await r.json()).order.paymentStatus, "Failed");
    const headers = { "X-Order-Token": body.guestAccessToken };
    r = await fetch(`${base}/api/orders/${n}`, { headers });
    const seen = (await r.json()).order;
    assert.equal(seen.manualPayment.rejectReason, "No such transaction");
    assert.equal(seen.canResubmitTrxId, true);
    r = await post(`/api/orders/${n}/payment`, { trxId: "QQ11WW22EE", senderNumber: "01811111111" }, headers);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).order.paymentStatus, "Verifying");
    const doc = await Order.findOne({ orderNumber: n }).lean();
    assert.equal(doc.manualPayment.previous[0].trxId, "ZZ99YY88XX");
});

test("COD lifecycle: delivered marks it paid and updates the customer book", async () => {
    const { body } = await place();
    const n = body.orderNumber;
    for (const status of ["Confirmed", "Shipped", "Delivered"]) {
        const r = await patch(`/api/admin/orders/${n}/status`, { status });
        assert.equal(r.status, 200, status);
    }
    const doc = await Order.findOne({ orderNumber: n }).lean();
    assert.equal(doc.paymentStatus, "Paid");
    assert.equal(doc.amountPaid, 1270);
    assert.equal(doc.stockDeducted, true);
    const c = await Customer.findOne({ phone: doc.shippingAddress.phone }).lean();
    assert.equal(c.deliveredCount, 1);
    assert.equal(c.totalSpent, 1270);
    const r = await patch(`/api/admin/orders/${n}/status`, { status: "Pending" });
    assert.equal(r.status, 409);
});

test("confirm refuses to oversell", async () => {
    const { body } = await place({ items: [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: 3 }] });
    const keep = await stock();
    await Product.updateOne({ slug: "kasturi-active-power" }, { $set: { stock: 2 } });
    const r = await patch(`/api/admin/orders/${body.orderNumber}/status`, { status: "Confirmed" });
    assert.equal(r.status, 409);
    assert.equal(await stock(), 2);
    assert.equal((await Order.findOne({ orderNumber: body.orderNumber }).lean()).stockDeducted, false);
    await Product.updateOne({ slug: "kasturi-active-power" }, { $set: { stock: keep } });
});

test("SSLCommerz: redirect, validated success marks paid once, IPN is idempotent", async () => {
    const { res, body } = await place({ paymentMethod: "Online" });
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.deepEqual(body.nextAction, { type: "redirect", url: "https://sandbox.sslcommerz.com/gw" });
    assert.equal(gw.sslTran, `${body.orderNumber}-1`);
    const form = (p, data) =>
        fetch(`${base}/api/payments/sslcommerz/${p}`, {
            method: "POST",
            redirect: "manual",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://sandbox.sslcommerz.com" },
            body: new URLSearchParams(data),
        });
    let r = await form("success", { tran_id: gw.sslTran, val_id: "VAL1", status: "VALID" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `https://shop.test/order/${body.orderNumber}?payment=success`);
    let doc = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    assert.equal(doc.paymentStatus, "Paid");
    assert.equal(doc.amountPaid, 1270);
    assert.equal(doc.gatewayPayment.trxId, "BANK-VAL1");
    r = await form("ipn", { tran_id: gw.sslTran, val_id: "VAL1", status: "VALID" });
    assert.equal(r.status, 200);
    doc = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    assert.equal(doc.gatewayPayment.trxId, "BANK-VAL1");
});

test("SSLCommerz: a wrong amount is not accepted as paid; retry opens a new attempt", async () => {
    const { body } = await place({ paymentMethod: "Online" });
    gw.sslAmount = 1;
    const r = await fetch(`${base}/api/payments/sslcommerz/success`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tran_id: gw.sslTran, val_id: "VAL2" }),
    });
    gw.sslAmount = null;
    assert.match(r.headers.get("location"), /payment=failed/);
    const doc = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    assert.equal(doc.paymentStatus, "Pending");
    assert.match(doc.gatewayPayment.lastError, /does not match/);
    const retry = await post(`/api/orders/${body.orderNumber}/pay`, {}, { "X-Order-Token": body.guestAccessToken });
    assert.equal(retry.status, 200);
    assert.equal(gw.sslTran, `${body.orderNumber}-2`);
});

test("a fake gateway 'fail' post changes nothing", async () => {
    const { body } = await place({ paymentMethod: "Online" });
    await fetch(`${base}/api/payments/sslcommerz/fail`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tran_id: `${body.orderNumber}-1` }),
    });
    assert.equal((await Order.findOne({ orderNumber: body.orderNumber }).lean()).paymentStatus, "Pending");
});

test("bKash gateway: create, callback success executes and marks paid", async () => {
    await SiteSettings.updateOne({ key: "main" }, { $set: { "payment.bkash.mode": "gateway" } });
    gw.bkashAmount = null;
    const { res, body } = await place({ paymentMethod: "bKash" });
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.nextAction.url, "https://pay.bkash.test/x");
    assert.equal(body.order.paymentStatus, "Pending");
    const r = await fetch(`${base}/api/payments/bkash/callback?paymentID=PAY-${body.orderNumber}&status=success`, { redirect: "manual" });
    assert.equal(r.status, 303);
    assert.match(r.headers.get("location"), /payment=success$/);
    const doc = await Order.findOne({ orderNumber: body.orderNumber }).lean();
    assert.equal(doc.paymentStatus, "Paid");
    assert.ok(doc.gatewayPayment.trxId);
    const c = await fetch(`${base}/api/payments/bkash/callback?paymentID=nope&status=cancel`, { redirect: "manual" });
    assert.equal(c.headers.get("location"), "https://shop.test/?payment=cancelled");
    await SiteSettings.updateOne({ key: "main" }, { $set: { "payment.bkash.mode": "manual" } });
});

test("admin list, search, needs-attention count and CSV export", async () => {
    await place({ name: "=HYPERLINK(1)" });
    let r = await adminGet("/api/admin/orders?status=Pending&limit=5");
    const list = await r.json();
    assert.equal(r.status, 200);
    assert.ok(list.orders.length <= 5);
    assert.ok(list.statusCounts.Pending > 0);
    assert.equal(typeof list.needsAttention.paymentsToVerify, "number");
    r = await adminGet(`/api/admin/orders?q=${manualOrder.orderNumber}`);
    assert.equal((await r.json()).orders[0].orderNumber, manualOrder.orderNumber);
    r = await adminGet("/api/admin/orders/export");
    const csv = await r.text();
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.match(csv, /'=HYPERLINK\(1\)/);
    r = await adminGet("/api/admin/customers?q=Test");
    assert.equal(r.status, 200);
});
