// services/revalidate.js
// Tells the Next.js storefront to drop its cached pages after a dashboard
// save, so a price or copy change shows at once instead of after the cache
// window. Fire and forget: a storefront that is down must not fail a save.
// The storefront route (Phase 4) checks the secret and calls revalidateTag.
import env from "../config/env.js";

export const revalidateStorefront = (tags = ["storefront"]) => {
    if (!env.revalidate.url || !env.revalidate.secret) return;
    globalThis
        .fetch(env.revalidate.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-revalidate-secret": env.revalidate.secret },
            body: JSON.stringify({ tags }),
            signal: AbortSignal.timeout(5000),
        })
        .then((res) => {
            if (!res.ok) console.error(`Storefront revalidate answered ${res.status}`);
        })
        .catch((err) => console.error("Storefront revalidate failed:", err.message));
};
