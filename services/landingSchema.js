// services/landingSchema.js
// Server side twin of the dashboard form schema (genetic-ayur-front/lib/
// schema.js). LandingPage.sections is Mixed in Mongo, so this is the only
// thing between a dashboard request and what every visitor sees: unknown
// keys are dropped, strings trimmed and capped, lists capped, images limited
// to https URLs or site paths. Adding a field to a section = one line here
// and one line in the front's lib/schema.js.

import { isSafeImageUrl } from "../utils/url.js";

const text = (max = 200) => ({ type: "text", max });
const area = (max = 2000) => ({ type: "text", max });
const image = { type: "image" };
const bool = { type: "bool" };
const strings = (maxItems, max = 200) => ({ type: "strings", maxItems, max });
const list = (maxItems, fields) => ({ type: "list", maxItems, fields });
const select = (options) => ({ type: "select", options });

export const SECTION_SPECS = {
    hero: { kicker: text(120), title: area(300), text: area(), primaryCta: text(60), secondaryCta: text(60), notes: strings(3, 80) },
    trust: { items: list(8, { icon: select(["cash", "truck", "phone", "leaf", "shield"]), title: text(80), text: text(200) }) },
    benefits: {
        title: text(),
        text: area(),
        image,
        handNote: text(80),
        items: list(12, { title: text(120), text: area(600) }),
    },
    ingredients: {
        title: text(),
        text: area(),
        items: list(20, { name: text(80), featured: bool, latin: text(120), text: area(800), image }),
    },
    usage: { title: text(), text: area(), slipTitle: text(120), steps: strings(12, 300), signature: text(80), caution: area(800) },
    reviews: { title: text(), text: text(300), items: list(30, { name: text(80), location: text(80), text: area(1000), isSample: bool }) },
    order: { title: text(), text: area(), submitLabel: text(60), successTitle: text(120), successText: area(800) },
    faq: { title: text(), text: text(300), items: list(30, { q: text(300), a: area(2000) }) },
    // Grid of the other products (multi-product stores).
    products: { title: text(), text: area() },
};

// Extra rules a field spec cannot express.
const SECTION_CHECKS = {
    ingredients: (s) => ((s.items || []).filter((i) => i.featured).length > 4 ? "Up to 4 ingredients can be shown as a large photo" : null),
};

const cleanValue = (spec, value, path, errors) => {
    switch (spec.type) {
        case "text":
        case "image": {
            if (value === undefined || value === null) return "";
            if (typeof value !== "string") return errors.push(`${path} must be text`), "";
            const v = value.trim();
            if (spec.type === "text" && v.length > spec.max) errors.push(`${path} is longer than ${spec.max} characters`);
            if (spec.type === "image" && !isSafeImageUrl(v)) errors.push(`${path} must be an https image URL or a /path`);
            return v;
        }
        case "bool":
            return value === true;
        case "select":
            if (value === undefined || value === "") return spec.options[0];
            if (!spec.options.includes(value)) errors.push(`${path} must be one of ${spec.options.join(", ")}`);
            return value;
        case "strings": {
            if (value === undefined) return [];
            if (!Array.isArray(value)) return errors.push(`${path} must be a list`), [];
            if (value.length > spec.maxItems) errors.push(`${path} can have up to ${spec.maxItems} items`);
            return value.slice(0, spec.maxItems).map((v, i) => cleanValue({ type: "text", max: spec.max }, v, `${path}[${i}]`, errors));
        }
        case "list": {
            if (value === undefined) return [];
            if (!Array.isArray(value)) return errors.push(`${path} must be a list`), [];
            if (value.length > spec.maxItems) errors.push(`${path} can have up to ${spec.maxItems} items`);
            return value.slice(0, spec.maxItems).map((item, i) => {
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                    errors.push(`${path}[${i}] must be an object`);
                    return {};
                }
                const out = {};
                for (const [k, s] of Object.entries(spec.fields)) out[k] = cleanValue(s, item[k], `${path}[${i}].${k}`, errors);
                return out;
            });
        }
        default:
            return undefined;
    }
};

/**
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
export const cleanSection = (key, input) => {
    const spec = SECTION_SPECS[key];
    if (!spec) return { ok: false, errors: [`Unknown section "${key}"`] };
    if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: [`${key} must be an object`] };
    const errors = [];
    const value = { enabled: input.enabled !== false };
    for (const [k, s] of Object.entries(spec)) value[k] = cleanValue(s, input[k], `${key}.${k}`, errors);
    const extra = SECTION_CHECKS[key]?.(value);
    if (extra) errors.push(`${key}: ${extra}`);
    return errors.length ? { ok: false, errors } : { ok: true, value };
};
