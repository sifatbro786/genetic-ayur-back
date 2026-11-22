// services/images.js
// Every upload is re-encoded, never stored as sent: sharp decodes it (so a
// renamed .exe or an SVG with script is refused), auto-rotates by EXIF, drops
// all metadata (phone photos carry GPS), caps the size and writes WebP.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import env from "../config/env.js";

// Longest edge per use. Hero/product cut-outs stay sharp on retina screens;
// a logo never needs more than 600 px.
export const IMAGE_KINDS = { content: 1600, product: 1400, logo: 600 };
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export class ImageError extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
        this.expose = true;
    }
}

/** @returns {Promise<{buffer: Buffer, width: number, height: number}>} */
export const toWebp = async (input, kind = "content") => {
    const max = IMAGE_KINDS[kind] || IMAGE_KINDS.content;
    let img;
    try {
        // 40 MP cap: a tiny file that decodes to a gigantic canvas (a
        // decompression bomb) is refused before it eats the VPS memory.
        img = sharp(input, { limitInputPixels: 40_000_000, animated: false, failOn: "error" });
        const meta = await img.metadata();
        if (!["jpeg", "png", "webp", "avif", "heif"].includes(meta.format)) throw new ImageError("Upload a JPG, PNG, WebP or AVIF image");
    } catch (err) {
        if (err instanceof ImageError) throw err;
        throw new ImageError("This file is not a readable image");
    }
    const { data, info } = await img
        .rotate()
        .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
        // Logos and cut-outs keep transparency; WebP supports alpha.
        .webp({ quality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
};

/** Saves under uploads/YYYY/MM/<random>.webp; returns the public URL. */
export const saveUpload = async (buffer) => {
    const now = new Date();
    const rel = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), `${crypto.randomBytes(12).toString("hex")}.webp`);
    const abs = path.resolve(env.uploadDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // "wx": never overwrite (random names make a clash practically impossible).
    await fs.writeFile(abs, buffer, { flag: "wx" });
    return { url: `${env.apiPublicUrl}/uploads/${rel}`, path: rel };
};
