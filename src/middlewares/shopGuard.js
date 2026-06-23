// src/middlewares/shopGuard.js
// FIX: billing blok tekshiruvi qo'shildi
"use strict";
const Shop = require("../models/Shop");
const { isShopBlocked, calcMonthlyPrice } = require("../billing/billingService");

async function shopGuard(req, res, next) {
    const shopId = req.headers["x-shop-id"] || req.query.shopId;
    if (!shopId) return res.status(400).json({ ok: false, error: "shopId kerak" });

    const shop = await Shop.findById(shopId).lean().catch(() => null);
    if (!shop)        return res.status(404).json({ ok: false, error: "Do'kon topilmadi" });
    if (!shop.isActive) return res.status(403).json({ ok: false, error: "Do'kon nofaol" });

    // Billing blok tekshiruvi
    if (isShopBlocked(shop)) {
        const price = calcMonthlyPrice(shop);
        return res.status(402).json({
            ok: false,
            error: "PAYMENT_REQUIRED",
            message: "Oylik to'lov amalga oshirilmagan. Iltimos to'lovni amalga oshiring.",
            price,
            contact: "@botpos_support",
        });
    }

    req.shopId = shop._id;
    req.shop   = shop;
    next();
}

module.exports = { shopGuard };
