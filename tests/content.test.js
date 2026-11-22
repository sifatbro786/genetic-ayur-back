// Landing section cleaning, image URL rules and image re-encoding. No DB.
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { defaultLanding } from "../seed/defaults.js";
import { toWebp } from "../services/images.js";
import { SECTION_SPECS, cleanSection } from "../services/landingSchema.js";
import { isSafeImageUrl } from "../utils/url.js";

test("every seeded section passes and comes back unchanged", () => {
    for (const [key, section] of Object.entries(defaultLanding.sections)) {
        const r = cleanSection(key, section);
        assert.equal(r.ok, true, `${key}: ${r.errors}`);
        // A missing boolean comes back as false; nothing else may change.
        const noFalse = (o) => JSON.parse(JSON.stringify(o, (_k, v) => (v === false ? undefined : v)));
        assert.deepEqual(noFalse(r.value), noFalse({ enabled: true, ...section }), key);
    }
    // The dashboard and this file must list the same sections.
    for (const key of Object.keys(defaultLanding.sections)) assert.ok(SECTION_SPECS[key], key);
});

test("unknown keys are dropped, strings trimmed, wrong types reported", () => {
    let r = cleanSection("faq", { title: "  প্রশ্ন  ", text: "", items: [{ q: "Q", a: "A", html: "<b>x</b>" }], script: "x" });
    assert.equal(r.ok, true);
    assert.equal(r.value.title, "প্রশ্ন");
    assert.equal(r.value.script, undefined);
    assert.deepEqual(r.value.items[0], { q: "Q", a: "A" });
    r = cleanSection("faq", { title: { $gt: "" } });
    assert.equal(r.ok, false);
    r = cleanSection("hero", { notes: ["a", "b", "c", "d"] });
    assert.match(r.errors[0], /up to 3/);
    assert.equal(cleanSection("nope", {}).ok, false);
});

test("caps: lengths, list sizes, featured ingredients, icon enum", () => {
    assert.equal(cleanSection("order", { title: "x".repeat(201) }).ok, false);
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `n${i}`, featured: true }));
    assert.match(cleanSection("ingredients", { items }).errors[0], /Up to 4/);
    assert.equal(cleanSection("trust", { items: [{ icon: "skull", title: "t", text: "x" }] }).ok, false);
    assert.equal(cleanSection("reviews", { items: Array.from({ length: 31 }, () => ({ name: "a" })) }).ok, false);
});

test("image URLs: https or site path only", () => {
    for (const ok of ["", "/images/a.webp", "https://images.unsplash.com/photo-1?w=900&q=75", "https://api.x.com/uploads/2026/11/ab.webp"]) {
        assert.equal(isSafeImageUrl(ok), true, ok);
    }
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAA", "http://x.com/a.png", "//evil.com/a.png", "/../etc/passwd", "https://x.com/a.png\" onerror=\"x"]) {
        assert.equal(isSafeImageUrl(bad), false, bad);
    }
    assert.equal(cleanSection("benefits", { image: "javascript:alert(1)" }).ok, false);
});

test("images are re-encoded to WebP, shrunk and stripped of metadata", async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#2f5d3a" } })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Copyright: "secret gps owner" } } })
        .toBuffer();
    const out = await toWebp(big, "content");
    assert.equal(out.width, 1600);
    assert.equal(out.height, 1067);
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.exif, undefined);
    const logo = await toWebp(big, "logo");
    assert.equal(logo.width, 600);
    const small = await sharp({ create: { width: 200, height: 100, channels: 4, background: "#0000" } }).png().toBuffer();
    const kept = await toWebp(small, "content");
    assert.equal(kept.width, 200);
    assert.equal((await sharp(kept.buffer).metadata()).hasAlpha, true);
});

test("non-images, SVG and oversized canvases are refused", async () => {
    await assert.rejects(toWebp(Buffer.from("MZ not an image")), { status: 400 });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await assert.rejects(toWebp(svg), { status: 400 });
    const bomb = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
    await assert.rejects(toWebp(bomb), { status: 400 });
});
