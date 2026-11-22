import { Router } from "express";
import { body, param } from "express-validator";
import {
    changeStock,
    createProduct,
    deleteProduct,
    getProduct,
    listMovements,
    listProducts,
    updateProduct,
} from "../../controllers/admin/productController.js";
import { adminProtect } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";

const id = param("id").isMongoId().withMessage("Product not found");

// Structure and ranges here; uniqueness of packs, slug format and image URLs
// are checked by the Product model on save. `create` makes the required
// fields required; `update` accepts any subset.
const productRules = (create) => {
    const req = (chain) => (create ? chain : chain.optional());
    return [
        req(body("name")).isString().trim().isLength({ min: 1, max: 120 }).withMessage("English name is required (max 120)"),
        req(body("nameBn")).isString().trim().isLength({ min: 1, max: 120 }).withMessage("Bangla name is required (max 120)"),
        body("slug").optional().isString().isLength({ max: 80 }),
        body("shortDescription").optional().isString().isLength({ max: 300 }),
        body("description").optional().isString().isLength({ max: 5000 }),
        body("image").optional().isString().isLength({ max: 500 }),
        body("gallery").optional().isArray({ max: 8 }).withMessage("Up to 8 gallery images"),
        body("gallery.*").isString().isLength({ max: 500 }),
        body("netWeight").optional().isString().isLength({ max: 40 }),
        body("isActive").optional().isBoolean({ strict: true }),
        body("sortOrder").optional().isInt({ min: -1000, max: 100000 }).toInt(),
        req(body("variants")).isArray({ min: 1, max: 10 }).withMessage("A product needs 1 to 10 packs"),
        body("variants.*.options").isArray({ min: 1, max: 3 }).withMessage("Each pack needs a name"),
        body("variants.*.options.*.name").isString().trim().isLength({ min: 1, max: 40 }),
        body("variants.*.options.*.value").isString().trim().isLength({ min: 1, max: 60 }).withMessage("Pack name is required"),
        body("variants.*.price").isInt({ min: 0, max: 1_000_000 }).withMessage("Price must be whole taka").toInt(),
        body("variants.*.comparePrice").optional().isInt({ min: 0, max: 1_000_000 }).toInt(),
        body("variants.*.units").optional().isInt({ min: 1, max: 100 }).withMessage("Units per pack must be 1 to 100").toInt(),
        body("variants.*.note").optional().isString().isLength({ max: 80 }),
        body("variants.*.freeShipping").optional().isBoolean({ strict: true }),
        body("variants.*.isPopular").optional().isBoolean({ strict: true }),
        ...(create ? [body("stock").optional().isInt({ min: 0, max: 1_000_000 }).withMessage("Opening stock must be a whole number").toInt()] : []),
    ];
};

const router = Router();
router.use(adminProtect);

router.get("/", listProducts);
router.post("/", productRules(true), validate, createProduct);
router.get("/:id", id, validate, getProduct);
router.put("/:id", id, productRules(false), validate, updateProduct);
router.delete("/:id", id, validate, deleteProduct);
router.post(
    "/:id/stock",
    id,
    body("change").isInt({ min: -100_000, max: 100_000 }).not().equals("0").withMessage("Change must be a non-zero whole number").toInt(),
    body("reason").isIn(["restock", "correction", "damaged"]).withMessage("Reason must be restock, correction or damaged"),
    body("note").optional().isString().isLength({ max: 300 }),
    validate,
    changeStock,
);
router.get("/:id/stock-movements", id, validate, listMovements);

export default router;
