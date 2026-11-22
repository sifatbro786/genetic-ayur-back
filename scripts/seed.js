// scripts/seed.js
// Creates the store's starting content from seed/defaults.js (a copy of the
// storefront's defaults, so the live site looks exactly like the approved demo).
//
//   npm run seed         only creates what is missing. Safe to run any time;
//                        never touches content the owner edited.
//   npm run seed:force   OVERWRITES site settings, landing page and the seed
//                        product with the defaults. Dashboard edits are lost.
import mongoose from "mongoose";
import { assertEnv } from "../config/env.js";
import { connectDB } from "../config/db.js";
import LandingPage from "../models/LandingPage.js";
import Product from "../models/Product.js";
import SiteSettings from "../models/SiteSettings.js";
import { buildSeed } from "../seed/build.js";

assertEnv();
const force = process.argv.includes("--force");

await connectDB();
const { site, landing, products } = buildSeed();

const upsert = async (Model, filter, doc, label) => {
    const existing = await Model.findOne(filter);
    if (existing && !force) {
        console.log(`  skip    ${label} (exists; use --force to overwrite)`);
        return;
    }
    if (existing) {
        existing.overwrite({ ...doc, ...filter });
        await existing.save();
        console.log(`  replace ${label}`);
    } else {
        await Model.create({ ...doc, ...filter });
        console.log(`  create  ${label}`);
    }
};

try {
    console.log(force ? "Seeding (FORCE: overwriting)" : "Seeding (missing documents only)");
    await upsert(SiteSettings, { key: "main" }, site, "site settings");
    await upsert(LandingPage, { key: "main" }, landing, "landing page");
    for (const p of products) await upsert(Product, { slug: p.slug }, p, `product ${p.slug}`);
    console.log("Done.");
} catch (err) {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
} finally {
    await mongoose.connection.close();
}
