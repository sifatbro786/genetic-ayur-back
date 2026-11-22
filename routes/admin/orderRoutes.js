import { Router } from "express";
import { body, param } from "express-validator";
import { listCustomers } from "../../controllers/admin/customerController.js";
import {
    addNote,
    exportOrders,
    getOrder,
    listOrders,
    recheckPayment,
    updatePayment,
    updateStatus,
} from "../../controllers/admin/orderController.js";
import { adminProtect } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { ORDER_STATUSES } from "../../models/Order.js";
import { ORDER_NUMBER_RE } from "../../services/orderNumber.js";

const byNumber = param("orderNumber").matches(ORDER_NUMBER_RE).withMessage("Order not found");

export const orderRouter = Router();
orderRouter.use(adminProtect);

// Literal routes before /:orderNumber.
orderRouter.get("/", listOrders);
orderRouter.get("/export", exportOrders);
orderRouter.get("/:orderNumber", byNumber, validate, getOrder);
orderRouter.patch(
    "/:orderNumber/status",
    byNumber,
    body("status").isIn(ORDER_STATUSES).withMessage("Unknown status"),
    body("note").optional().isString().isLength({ max: 300 }),
    validate,
    updateStatus,
);
orderRouter.patch(
    "/:orderNumber/payment",
    byNumber,
    body("action").isIn(["verify", "reject", "refunded"]).withMessage("Unknown action"),
    body("reason").optional().isString().isLength({ max: 300 }),
    validate,
    updatePayment,
);
orderRouter.post("/:orderNumber/payment/recheck", byNumber, validate, recheckPayment);
orderRouter.post(
    "/:orderNumber/notes",
    byNumber,
    body("note").isString().trim().isLength({ min: 1, max: 1000 }).withMessage("Write a note"),
    validate,
    addNote,
);

export const customerRouter = Router();
customerRouter.use(adminProtect);
customerRouter.get("/", listCustomers);
