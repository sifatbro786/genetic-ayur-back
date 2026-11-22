// middlewares/validate.js
// Runs after an express-validator chain. Returns the first message per field
// so the storefront can show it next to the input, plus the full list.
import { validationResult } from "express-validator";

export const validate = (req, res, next) => {
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const errors = result.array({ onlyFirstError: true }).map((e) => ({ field: e.path, message: e.msg }));
    return res.status(400).json({ success: false, message: errors[0].message, errors });
};
