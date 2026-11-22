import { Router } from "express";
import { body } from "express-validator";
import { getLanding, getSite, updateLanding, updateSite } from "../../controllers/admin/contentController.js";
import { adminProtect } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { SECTION_KEYS } from "../../models/LandingPage.js";

const objectOpt = (field) => body(field).optional().isObject().withMessage(`${field} must be an object`);

export const siteRouter = Router();
siteRouter.use(adminProtect);
siteRouter.get("/", getSite);
// Shapes only; values are validated by the SiteSettings model on save.
siteRouter.put(
    "/",
    ["announcement", "payment", "payment.cod", "payment.bkash", "payment.nagad", "payment.online", "footer", "legal", "seo"].map(objectOpt),
    body("shipping").optional().isArray({ max: 3 }).withMessage("shipping must be a list of up to 3 zones"),
    body("email").optional().isString().trim().isLength({ max: 160 }).bail().custom((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)).withMessage("Enter a valid email"),
    validate,
    updateSite,
);

export const landingRouter = Router();
landingRouter.use(adminProtect);
landingRouter.get("/", getLanding);
landingRouter.put(
    "/",
    body("order").optional().isArray({ max: SECTION_KEYS.length }).withMessage("order must be a list of sections"),
    body("order.*").isIn(SECTION_KEYS).withMessage("Unknown section in order"),
    body("productSlug").optional().isSlug().isLength({ max: 80 }),
    objectOpt("sections"),
    validate,
    updateLanding,
);
