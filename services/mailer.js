// services/mailer.js
// Shop alerts by SMTP (Gmail App Password). Fire and forget: an order is
// never blocked or failed because Gmail is slow or the password is wrong.
// Without SMTP_PASS the alerts are skipped silently.
import nodemailer from "nodemailer";
import env, { mailConfigured } from "../config/env.js";

let transporter;
const getTransport = () => {
    transporter ||= nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: { user: env.smtp.user, pass: env.smtp.pass },
        connectionTimeout: 10_000,
        socketTimeout: 15_000,
    });
    return transporter;
};

const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tk = (n) => `৳${Number(n || 0).toLocaleString("en-IN")}`;

const orderHtml = (o, headline) => {
    const rows = o.orderItems
        .map(
            (i) =>
                `<tr><td style="padding:4px 8px">${esc(i.nameBn || i.name)} (${esc(i.variant.options.map((x) => x.value).join(" / "))})</td>` +
                `<td style="padding:4px 8px">x${i.quantity}</td><td style="padding:4px 8px;text-align:right">${tk(i.lineTotal)}</td></tr>`,
        )
        .join("");
    const a = o.shippingAddress;
    const pay =
        o.payNow > 0
            ? `<p><b>Pay now:</b> ${tk(o.payNow)} via ${esc(o.payNowVia?.method)} (${esc(o.payNowVia?.flow)})` +
              (o.manualPayment ? ` · TrxID <b>${esc(o.manualPayment.trxId)}</b> from ${esc(o.manualPayment.senderNumber)}` : "") +
              `<br><b>Cash on delivery:</b> ${tk(o.payOnDelivery)}</p>`
            : `<p><b>Cash on delivery:</b> ${tk(o.totalPrice)}</p>`;
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
<h2 style="margin:0 0 8px">${esc(headline)}</h2>
<p><b>${esc(o.orderNumber)}</b> · ${esc(o.paymentMethod)} · payment ${esc(o.paymentStatus)}</p>
<table style="border-collapse:collapse">${rows}
<tr><td style="padding:4px 8px">Delivery (${esc(a.locationLabel)})</td><td></td><td style="padding:4px 8px;text-align:right">${tk(o.shippingPrice)}</td></tr>
<tr><td style="padding:4px 8px"><b>Total</b></td><td></td><td style="padding:4px 8px;text-align:right"><b>${tk(o.totalPrice)}</b></td></tr></table>
${pay}
<p><b>${esc(a.name)}</b> · ${esc(a.phone)}<br>${esc(a.addressLine1)}</p>
${o.customerNote ? `<p>Note: ${esc(o.customerNote)}</p>` : ""}
</div>`;
};

const send = (subject, html) => {
    if (!mailConfigured()) return;
    getTransport()
        .sendMail({ from: env.smtp.from, to: env.smtp.notifyTo, subject, html })
        // Message only: the error object can carry the SMTP transcript.
        .catch((err) => console.error("Order alert email failed:", err.message));
};

export const notifyNewOrder = (order) =>
    send(`New order ${order.orderNumber} · ${tk(order.totalPrice)}`, orderHtml(order, "New order"));

export const notifyPaymentReceived = (order) =>
    send(`Payment received ${order.orderNumber} · ${tk(order.amountPaid)}`, orderHtml(order, "Online payment received"));

export const notifyPaymentSubmitted = (order) =>
    send(`TrxID to verify ${order.orderNumber}`, orderHtml(order, "Payment reference submitted, please verify"));
