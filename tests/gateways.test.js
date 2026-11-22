// Gateway clients against a fake fetch: request shape, token caching, the
// execute -> query fallback, and SSLCommerz validation mapping. No network,
// no database.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.BKASH_APP_KEY = "app-key";
process.env.BKASH_APP_SECRET = "app-secret";
process.env.BKASH_USERNAME = "user";
process.env.BKASH_PASSWORD = "pass";
process.env.BKASH_BASE_URL = "https://bkash.test/v1.2.0-beta";
process.env.SSLCZ_STORE_ID = "store";
process.env.SSLCZ_STORE_PASSWORD = "secret";

const { setGatewayFetch } = await import("../services/payments/http.js");
const bkash = await import("../services/payments/bkash.js");
const ssl = await import("../services/payments/sslcommerz.js");

let calls;
const fake = (routes) =>
    setGatewayFetch(async (url, init = {}) => {
        const u = new URL(url);
        calls.push({ path: u.pathname, init, query: u.searchParams });
        const handler = routes[u.pathname];
        if (!handler) return new Response("not found", { status: 404 });
        const out = await handler(init.body ? (init.headers["Content-Type"]?.includes("json") ? JSON.parse(init.body) : init.body) : null, init);
        return new Response(typeof out === "string" ? out : JSON.stringify(out), { status: 200 });
    });

beforeEach(() => {
    calls = [];
    bkash.resetBkashToken();
});

const grant = () => ({ id_token: "tok-1", refresh_token: "ref-1", expires_in: 3600 });

test("bKash create sends invoice, amount and auth headers; token is cached", async () => {
    fake({
        "/v1.2.0-beta/tokenized/checkout/token/grant": (body, init) => {
            assert.equal(init.headers.username, "user");
            assert.equal(body.app_key, "app-key");
            return grant();
        },
        "/v1.2.0-beta/tokenized/checkout/create": (body, init) => {
            assert.equal(init.headers.Authorization, "tok-1");
            assert.equal(init.headers["X-APP-Key"], "app-key");
            assert.equal(body.mode, "0011");
            assert.equal(body.amount, "1270.00");
            assert.equal(body.merchantInvoiceNumber, "GA261122001");
            return { statusCode: "0000", paymentID: "PAY1", bkashURL: "https://pay.bka.sh/PAY1" };
        },
    });
    const s = await bkash.createPayment({ amount: 1270, invoice: "GA261122001", callbackURL: "https://api/cb" });
    assert.deepEqual(s, { sessionId: "PAY1", redirectUrl: "https://pay.bka.sh/PAY1" });
    await bkash.createPayment({ amount: 1270, invoice: "GA261122001", callbackURL: "https://api/cb" });
    assert.equal(calls.filter((c) => c.path.endsWith("/grant")).length, 1);
});

test("bKash create error surfaces as a GatewayError", async () => {
    fake({
        "/v1.2.0-beta/tokenized/checkout/token/grant": grant,
        "/v1.2.0-beta/tokenized/checkout/create": () => ({ statusCode: "2001", statusMessage: "Invalid App Key" }),
    });
    await assert.rejects(bkash.createPayment({ amount: 10, invoice: "GA1", callbackURL: "x" }), { name: "GatewayError" });
});

test("bKash execute falls back to the status query when execute is not Completed", async () => {
    fake({
        "/v1.2.0-beta/tokenized/checkout/token/grant": grant,
        "/v1.2.0-beta/tokenized/checkout/execute": () => ({ statusCode: "2117", statusMessage: "Payment execution already been called" }),
        "/v1.2.0-beta/tokenized/checkout/payment/status": () => ({
            transactionStatus: "Completed",
            trxID: "AB12CD34EF",
            amount: "1270",
            merchantInvoiceNumber: "GA261122001",
            paymentID: "PAY1",
        }),
    });
    const r = await bkash.executePayment("PAY1");
    assert.equal(r.completed, true);
    assert.equal(r.trxId, "AB12CD34EF");
    assert.equal(r.amount, 1270);
    assert.equal(r.invoice, "GA261122001");
});

test("bKash non JSON answer is a GatewayError, not a crash", async () => {
    fake({ "/v1.2.0-beta/tokenized/checkout/token/grant": () => "<html>502</html>" });
    await assert.rejects(bkash.queryPayment("PAY1"), { name: "GatewayError" });
});

const fakeOrder = {
    orderNumber: "GA261122001",
    orderItems: [{ name: "Kasturi", quantity: 2 }],
    shippingAddress: { name: "Test", phone: "01712345678", addressLine1: "House 1, Road 2, Dhaka", locationLabel: "ঢাকা" },
};

test("SSLCommerz init posts the form and returns the gateway page", async () => {
    fake({
        "/gwprocess/v4/api.php": (body) => {
            const f = new URLSearchParams(body);
            assert.equal(f.get("store_id"), "store");
            assert.equal(f.get("tran_id"), "GA261122001-1");
            assert.equal(f.get("total_amount"), "1270.00");
            assert.equal(f.get("ipn_url"), "https://api/ipn");
            assert.equal(f.get("num_of_item"), "2");
            return { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/1" };
        },
    });
    const s = await ssl.initPayment({
        tranId: "GA261122001-1",
        amount: 1270,
        order: fakeOrder,
        email: "shop@example.com",
        urls: { success: "https://api/s", fail: "https://api/f", cancel: "https://api/c", ipn: "https://api/ipn" },
    });
    assert.equal(s.redirectUrl, "https://sandbox.sslcommerz.com/gw/1");
    assert.equal(calls[0].query.size, 0);
});

test("SSLCommerz validation maps status, amount and risk", async () => {
    fake({
        "/validator/api/validationserverAPI.php": (_b, _i) => ({
            status: "VALID",
            tran_id: "GA261122001-1",
            val_id: "V1",
            amount: "1270.00",
            currency: "BDT",
            bank_tran_id: "B1",
            card_type: "BKASH-BKash",
            risk_level: "1",
        }),
    });
    const r = await ssl.validate("V1");
    assert.equal(calls[0].query.get("val_id"), "V1");
    assert.equal(r.completed, true);
    assert.equal(r.amount, 1270);
    assert.equal(r.sessionId, "GA261122001-1");
    assert.equal(r.risky, true);
});

test("SSLCommerz tran_id lookup finds the valid attempt", async () => {
    fake({
        "/validator/api/merchantTransIDvalidationAPI.php": () => ({
            APIConnect: "DONE",
            element: [{ status: "FAILED" }, { status: "VALIDATED", tran_id: "GA261122001-2", amount: "70.00", currency: "BDT", bank_tran_id: "B2" }],
        }),
    });
    const r = await ssl.queryByTranId("GA261122001-2");
    assert.equal(r.completed, true);
    assert.equal(r.trxId, "B2");
});
