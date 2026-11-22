import { Router } from "express";
import { param } from "express-validator";
import {
    getLanding,
    getProductBySlug,
    getProducts,
    getSite,
    getStorefront,
} from "../controllers/storefrontController.js";
import { validate } from "../middlewares/validate.js";

const router = Router();

router.get("/storefront", getStorefront);
router.get("/site", getSite);
router.get("/landing", getLanding);
router.get("/products", getProducts);
router.get(
    "/products/:slug",
    param("slug").isSlug().isLength({ max: 80 }).withMessage("Invalid product"),
    validate,
    getProductBySlug,
);

export default router;
