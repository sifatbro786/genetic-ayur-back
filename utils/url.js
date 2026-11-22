// utils/url.js
// Image sources the storefront will put in <img src>: a site path
// ("/images/x.webp") or an absolute https URL. No javascript:, data:, http:
// or protocol-relative "//host" sources.
export const isSafeImageUrl = (v) =>
    v === "" || (typeof v === "string" && ((/^\/(?!\/)[\w\-./%]+$/.test(v) && !v.includes("..")) || /^https:\/\/[^\s"'<>\\]+$/.test(v)));

export const isHttpsUrl = (v) => v === "" || (typeof v === "string" && /^https:\/\/[^\s"'<>\\]+$/.test(v));
