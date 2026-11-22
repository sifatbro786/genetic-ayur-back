// controllers/checkoutController.js
import { quoteOrder } from "../services/pricing.js";

// POST /api/checkout/calculate
// Body: { items: [{ slug, options, quantity }], zone, paymentMethod? }
// 200 { success: true, totals }   |   4xx { success: false, code, message }
// The storefront shows these numbers; it never computes its own.
export const calculate = async (req, res) => {
    const { items, zone, paymentMethod } = req.body;
    const result = await quoteOrder({ items, zoneKey: zone, paymentMethod });
    res.set("Cache-Control", "no-store");
    if (!result.ok) {
        const { status, ok: _ok, ...body } = result;
        return res.status(status).json({ success: false, ...body });
    }
    res.json({ success: true, totals: result.totals });
};
