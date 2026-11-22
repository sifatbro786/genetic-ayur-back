// utils/phone.js (from the Footpath base, plus Bangla digits)
// Stored form is the 11 digit local number "01XXXXXXXXX", whatever the
// shopper typed: "+8801712-345678", "8801712345678", "01712 345678", or
// "০১৭১২৩৪৫৬৭৮" from a Bangla keyboard (common on this storefront).
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/** @returns {string|null} "01XXXXXXXXX" or null when it is not a BD mobile */
export const normalizeBdPhone = (raw) => {
    if (raw === undefined || raw === null) return null;
    let d = String(raw)
        .replace(/[০-৯]/g, (c) => String(BN_DIGITS.indexOf(c)))
        .replace(/\D/g, "");
    if (d.startsWith("00880")) d = d.slice(5);
    else if (d.startsWith("880")) d = d.slice(3);
    if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
    return /^01[3-9]\d{8}$/.test(d) ? d : null;
};
