// src/middlewares/billingGuard.js
// Bot xabari va WebApp — billing bloklash tekshiruvi
"use strict";
const Shop = require("../models/Shop");
const { isShopBlocked, calcMonthlyPrice } = require("../billing/billingService");

// ─── WEBAPP API GUARD ─────────────────────────────────────────────────────────
// shopGuard dan KEYIN chaqiriladi (req.shop mavjud)
async function billingGuard(req, res, next) {
    const shop = req.shop;
    if (!shop) return next();

    if (isShopBlocked(shop)) {
        const price = calcMonthlyPrice(shop);
        return res.status(402).json({
            ok: false,
            error: "PAYMENT_REQUIRED",
            message: "Oylik to'lov amalga oshirilmagan. Iltimos, to'lovni amalga oshiring.",
            price,
            contact: "@botpos_support",
        });
    }
    next();
}

// ─── BOT XABARI GUARD ────────────────────────────────────────────────────────
// shopHandlers.js da har xabarda chaqiriladi
async function checkShopBilling(shop) {
    if (!shop) return { blocked: false };

    if (isShopBlocked(shop)) {
        const price = calcMonthlyPrice(shop);
        return {
            blocked: true,
            message: [
                `🚫 <b>Tizim to'lov muammosi sababli vaqtincha bloklangan.</b>`,
                ``,
                `💰 To'lov summasi: <b>${price.toLocaleString()} so'm/oy</b>`,
                ``,
                `✅ To'lovni amalga oshiring va quyidagi tugmani bosing:`,
            ].join("\n"),
            keyboard: {
                inline_keyboard: [[
                    { text: "💳 To'lov ma'lumotlari", callback_data: "billing:info" },
                ]],
            },
        };
    }
    return { blocked: false };
}

module.exports = { billingGuard, checkShopBilling };
