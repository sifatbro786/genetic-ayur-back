// middlewares/error.js
// One response shape for every failure: { success: false, message }.
// Stack traces only in development; production never echoes internals.
import env from "../config/env.js";

export const notFound = (req, res) => {
    res.status(404).json({ success: false, message: `Not found: ${req.method} ${req.originalUrl}` });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.expose || status < 500 ? err.message : "Something went wrong";

    if (err.type === "entity.parse.failed") {
        status = 400;
        message = "Request body is not valid JSON";
    } else if (err.type === "entity.too.large") {
        status = 413;
        message = "Request body is too large";
    } else if (err.name === "CastError") {
        status = 404;
        message = "Resource not found";
    } else if (err.name === "ValidationError" && err.errors) {
        status = 400;
        message = Object.values(err.errors)
            .map((e) => e.message)
            .join(", ");
    } else if (err.code === 11000) {
        status = 409;
        const field = Object.keys(err.keyValue || err.keyPattern || {})[0];
        message = field ? `${field} already exists` : "Duplicate value";
    } else if (err.name === "MulterError") {
        status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        message = err.code === "LIMIT_FILE_SIZE" ? "Image is larger than 8 MB" : "Upload one image in the \"image\" field";
    }

    if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);

    res.status(status).json({
        success: false,
        message,
        ...(env.nodeEnv === "development" && status >= 500 ? { stack: err.stack } : {}),
    });
};
