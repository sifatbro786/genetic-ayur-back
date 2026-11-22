// middlewares/sanitize.js (verbatim logic from the Footpath base)
//
// NoSQL operator injection guard. Express 5 made req.query a getter-only
// accessor, so express-mongo-sanitize's own middleware and hpp both throw when
// they assign to it. This uses the library's sanitize() primitive in place and
// then redefines req.query as a plain writable property, which is also what
// lets hpp work at all. MUST be mounted before hpp (see app.js).
//
// Removes keys starting with "$" and keys containing "." by renaming them
// ("_"), so `{ "phone": { "$ne": "" } }` never reaches Mongoose as an operator.
import mongoSanitize from "express-mongo-sanitize";

const OPTIONS = { replaceWith: "_" };

const scrub = (target) => {
    if (target && typeof target === "object") mongoSanitize.sanitize(target, OPTIONS);
    return target;
};

export const sanitizeRequest = (req, _res, next) => {
    scrub(req.body);
    scrub(req.params);
    try {
        const snapshot = req.query;
        if (snapshot && typeof snapshot === "object") {
            Object.defineProperty(req, "query", {
                value: scrub(snapshot),
                writable: true,
                configurable: true,
                enumerable: true,
            });
        }
    } catch (err) {
        // A malformed query string can make the getter itself throw.
        err.status = 400;
        return next(err);
    }
    return next();
};
