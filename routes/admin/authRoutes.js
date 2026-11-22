import { Router } from "express";
import { body } from "express-validator";
import { changePassword, login, me } from "../../controllers/authController.js";
import { adminProtect } from "../../middlewares/auth.js";
import { authLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";

const router = Router();

router.post(
    "/login",
    authLimiter,
    body("email").isString().trim().isEmail().isLength({ max: 160 }).withMessage("Enter a valid email"),
    body("password").isString().isLength({ min: 1, max: 200 }).withMessage("Enter your password"),
    validate,
    login,
);

router.get("/me", adminProtect, me);

router.patch(
    "/password",
    authLimiter,
    adminProtect,
    body("currentPassword").isString().isLength({ min: 1, max: 200 }),
    // bcrypt only reads the first 72 bytes; a longer password would give a
    // false sense of strength.
    body("newPassword")
        .isString()
        .isLength({ min: 10, max: 72 })
        .withMessage("New password must be 10 to 72 characters"),
    validate,
    changePassword,
);

export default router;
