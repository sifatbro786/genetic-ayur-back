// controllers/admin/uploadController.js
import multer from "multer";
import { ACCEPTED_TYPES, IMAGE_KINDS, saveUpload, toWebp } from "../../services/images.js";

// Memory storage: the file is re-encoded by sharp before anything touches the
// disk, so the original bytes are never written anywhere.
export const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4, fieldSize: 1024 },
    fileFilter: (_req, file, cb) => {
        if (ACCEPTED_TYPES.includes(file.mimetype)) return cb(null, true);
        const err = new Error("Upload a JPG, PNG, WebP or AVIF image");
        err.status = 400;
        return cb(err);
    },
}).single("image");

// POST /api/admin/uploads  multipart: image (file), kind? (content|product|logo)
// 201 { success, url, width, height, bytes }
export const uploadImage = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'Attach an image in the "image" field' });
    const kind = Object.hasOwn(IMAGE_KINDS, req.body?.kind) ? req.body.kind : "content";
    const { buffer, width, height } = await toWebp(req.file.buffer, kind);
    const { url } = await saveUpload(buffer);
    res.status(201).json({ success: true, url, width, height, bytes: buffer.length });
};
