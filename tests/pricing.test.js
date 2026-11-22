import assert from "node:assert/strict";
import { test } from "node:test";
import { priceCart } from "../services/pricing.js";
import { normalizeBdPhone } from "../utils/phone.js";
import { variantKey } from "../utils/variants.js";

const pack = (value, price, extra = {}) => ({ options: [{ name: "প্যাক", value }], price, units: 1, ...extra });
const product = (over = {}) => ({
    slug: "kasturi-active-power",
    name: "Kasturi",
    nameBn: "কস্তুরী",
    isActive: true,
    stock: 20,
    variants: [pack("১ কৌটা", 1200, { comparePrice: 1500 }), pack("২ কৌটা", 2200, { units: 2, freeShipping: true })],
    ...over,
});
const site = (payment = {}) => ({
    shipping: [
        { key: "dhaka_inside", label: "ঢাকা", charge: 70, enabled: true },
        { key: "outside_dhaka", label: "বাইরে", charge: 130, enabled: true },
        { key: "dhaka_sub", label: "আশেপাশে", charge: 100, enabled: false },
    ],
    payment: { cod: { enabled: true }, bkash: { enabled: true }, nagad: { enabled: false }, codAdvance: "none", ...payment },
});
const run = (items, extra = {}, p = product(), s = site()) =>
    priceCart({ products: new Map([[p.slug, p]]), site: s, items, zoneKey: "dhaka_inside", ...extra });
const one = (qty = 1) => [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "১ কৌটা" }], quantity: qty }];

test("variant key ignores order, case and spacing", () => {
    assert.equal(
        variantKey([{ name: "Size", value: "L " }, { name: "color", value: "Red" }]),
        variantKey([{ name: " Color", value: "red" }, { name: "size", value: "l" }]),
    );
});

test("prices from the database, never from the request", () => {
    const r = run([{ ...one(2)[0], price: 1 }]);
    assert.equal(r.ok, true);
    assert.equal(r.totals.itemsPrice, 2400);
    assert.equal(r.totals.shippingPrice, 70);
    assert.equal(r.totals.totalPrice, 2470);
    assert.equal(r.totals.savings, 600);
    assert.equal(r.totals.payNow, 0);
});

test("repeated lines are merged before the quantity cap", () => {
    const r = run([...one(6), ...one(6)]);
    assert.equal(r.ok, false);
    assert.equal(r.code, "QUANTITY_LIMIT");
});

test("combo packs use units against shared stock", () => {
    const items = [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "২ কৌটা" }], quantity: 6 }, ...one(9)];
    const r = run(items); // 12 + 9 = 21 jars > 20
    assert.equal(r.code, "OUT_OF_STOCK");
    assert.equal(run(items.slice(0, 1)).ok, true);
});

test("a free shipping pack frees the whole parcel", () => {
    const items = [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "২ কৌটা" }], quantity: 1 }, ...one(1)];
    const r = run(items);
    assert.equal(r.totals.shippingPrice, 0);
    assert.equal(r.totals.freeShippingApplied, true);
});

test("unknown pack, inactive product, disabled zone, disabled method", () => {
    assert.equal(run([{ ...one()[0], options: [{ name: "প্যাক", value: "৩ কৌটা" }] }]).code, "PACK_NOT_FOUND");
    assert.equal(run(one(), {}, product({ isActive: false })).code, "PRODUCT_UNAVAILABLE");
    assert.equal(run(one(), { zoneKey: "dhaka_sub" }).code, "ZONE_UNAVAILABLE");
    assert.equal(run(one(), { paymentMethod: "Nagad" }).code, "PAYMENT_UNAVAILABLE");
});

test("bKash pays everything now; COD with advance pays delivery now", () => {
    const b = run(one(), { paymentMethod: "bKash" });
    assert.equal(b.totals.payNow, 1270);
    assert.equal(b.totals.payOnDelivery, 0);
    const c = run(one(), { paymentMethod: "COD" }, product(), site({ codAdvance: "delivery" }));
    assert.equal(c.totals.payNow, 70);
    assert.equal(c.totals.payOnDelivery, 1200);
    assert.equal(c.totals.requiresTrxId, true);
});

test("a gateway method is offered only when its keys exist", () => {
    const s = site({ bkash: { enabled: true, mode: "gateway" }, online: { enabled: true } });
    let r = run(one(), {}, product(), s);
    assert.deepEqual(r.totals.availablePaymentMethods, ["COD"]);
    assert.equal(run(one(), { paymentMethod: "Online" }, product(), s).code, "PAYMENT_UNAVAILABLE");
    r = run(one(), { paymentMethod: "bKash", gateways: { bkash: true, sslcommerz: true } }, product(), s);
    assert.deepEqual(r.totals.availablePaymentMethods, ["COD", "bKash", "Online"]);
    assert.equal(r.totals.payNow, 1270);
    assert.equal(r.totals.requiresTrxId, false);
    assert.equal(r.totals.redirectsToGateway, true);
    assert.deepEqual(r.totals.payNowVia, { method: "bKash", flow: "gateway", provider: "bkash" });
});

test("COD advance: channel chosen by advanceMethod, falls back when none is reachable", () => {
    const s = site({ codAdvance: "delivery", online: { enabled: true } });
    let r = run(one(), { paymentMethod: "COD", advanceMethod: "Online", gateways: { sslcommerz: true } }, product(), s);
    assert.equal(r.totals.payNow, 70);
    assert.equal(r.totals.payNowVia.method, "Online");
    assert.equal(r.totals.redirectsToGateway, true);
    assert.deepEqual(r.totals.advanceMethods, ["bKash", "Online"]);
    assert.equal(run(one(), { paymentMethod: "COD", advanceMethod: "Nagad" }, product(), s).code, "ADVANCE_METHOD_UNAVAILABLE");
    // Only a keyless gateway as prepaid option: the advance is skipped, not the order.
    const g = site({ codAdvance: "delivery", bkash: { enabled: false }, online: { enabled: true } });
    r = run(one(), { paymentMethod: "COD" }, product(), g);
    assert.equal(r.totals.payNow, 0);
    assert.equal(r.totals.payNowVia, null);
});

test("COD advance is not asked when the parcel ships free", () => {
    const items = [{ slug: "kasturi-active-power", options: [{ name: "প্যাক", value: "২ কৌটা" }], quantity: 1 }];
    const r = run(items, { paymentMethod: "COD" }, product(), site({ codAdvance: "delivery" }));
    assert.equal(r.totals.payNow, 0);
    assert.equal(r.totals.requiresTrxId, false);
});

test("phone normaliser accepts Bangla digits and +880", () => {
    assert.equal(normalizeBdPhone("০১৭১২৩৪৫৬৭৮"), "01712345678");
    assert.equal(normalizeBdPhone("+880 1712-345678"), "01712345678");
    assert.equal(normalizeBdPhone("0121234567"), null);
});
