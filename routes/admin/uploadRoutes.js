import { Router } from "express";
import { imageUpload, uploadImage } from "../../controllers/admin/uploadController.js";
import { adminProtect } from "../../middlewares/auth.js";
import { uploadLimiter } from "../../middlewares/rateLimiter.js";

const router = Router();

// Auth BEFORE multer: an anonymous request never gets its body buffered.
router.post("/", uploadLimiter, adminProtect, imageUpload, uploadImage);

export default router;
