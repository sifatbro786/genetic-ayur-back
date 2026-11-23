// utils/url.js
// Image sources the storefront will put in <img src>: a site path
// ("/images/x.webp") or an absolute https URL. No javascript:, data:, http:
// or protocol-relative "//host" sources.
//
// Exception outside production: http://localhost / 127.0.0.1. Uploads are
// saved as API_PUBLIC_URL + /uploads/..., which is http://localhost:5000 on a
// dev machine; without this every image uploaded locally fails validation.
// Production never accepts http (and env.js requires an https API there).
// NODE_ENV is read per call: this module can load before dotenv runs.
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/[^\s"'<>\\]+$/;

export const isSafeImageUrl = (v) =>
    v === "" ||
    (typeof v === "string" &&
        ((/^\/(?!\/)[\w\-./%]+$/.test(v) && !v.includes("..")) ||
            /^https:\/\/[^\s"'<>\\]+$/.test(v) ||
            (process.env.NODE_ENV !== "production" && LOCAL_HTTP.test(v))));

export const isHttpsUrl = (v) => v === "" || (typeof v === "string" && /^https:\/\/[^\s"'<>\\]+$/.test(v));
