// src/middlewares/shopGuard.js — shopId header yoki query dan olish va tekshirish
const Shop = require("../models/Shop");

async function shopGuard(req, res, next) {
    const shopId = req.headers["x-shop-id"] || req.query.shopId;
    if (!shopId) return res.status(400).json({ ok: false, error: "shopId kerak" });

    const shop = await Shop.findById(shopId).lean().catch(() => null);
    if (!shop) return res.status(404).json({ ok: false, error: "Do'kon topilmadi" });
    if (!shop.isActive) return res.status(403).json({ ok: false, error: "Do'kon nofaol" });

    req.shopId = shop._id;
    req.shop   = shop;
    next();
}

module.exports = { shopGuard };
