// src/routes/webapp.js — Web App API (do'kon sayt)
"use strict";
const express = require("express");
const mongoose = require("mongoose");
const Shop    = require("../models/Shop");
const Product = require("../models/Product");
const Order   = require("../models/Order");
const { getCatalog } = require("../services/catalogCache");
const { getBot }     = require("../saas/botManager");
const { formatMoney } = require("../utils/money");

function webappRoutes() {
    const r = express.Router();

    // ─── SHOP INFO ────────────────────────────────────────────────────────────
    // GET /api/webapp/:shopId
    r.get("/:shopId", async (req, res) => {
        try {
            const shop = await Shop.findById(req.params.shopId)
                .select("name webApp webappUrl billing.status isActive sector plan")
                .lean();

            if (!shop || !shop.isActive)
                return res.status(404).json({ ok: false, error: "Do'kon topilmadi" });

            if (!shop.webApp?.enabled)
                return res.status(403).json({ ok: false, error: "Web sayt yoqilmagan" });

            res.json({ ok: true, data: {
                shopId:    shop._id,
                name:      shop.webApp?.siteName || shop.name,
                shopName:  shop.name,
                bannerUrl: shop.webApp?.bannerUrl || "",
                phone:     shop.webApp?.phone || "",
                sector:    shop.sector || "boshqa",
                theme: {
                    primary:  shop.webApp?.theme?.primary  || "#0d0d0d",
                    accent:   shop.webApp?.theme?.accent   || "#f5c842",
                    bg:       shop.webApp?.theme?.bg       || "#faf6f0",
                    cardBg:   shop.webApp?.theme?.cardBg   || "#ffffff",
                    navBg:    shop.webApp?.theme?.navBg    || "#ffffff",
                    text:     shop.webApp?.theme?.text     || "#0d0d0d",
                    themeKey: shop.webApp?.theme?.themeKey || "dark",
                },
            }});
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── KATALOG ──────────────────────────────────────────────────────────────
    // GET /api/webapp/:shopId/catalog
    r.get("/:shopId/catalog", async (req, res) => {
        try {
            const catalog = await getCatalog(req.params.shopId);
            res.json({ ok: true, data: catalog });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── MAHSULOT ─────────────────────────────────────────────────────────────
    // GET /api/webapp/:shopId/products/:id
    r.get("/:shopId/products/:id", async (req, res) => {
        try {
            const p = await Product.findOne({
                _id:    req.params.id,
                shopId: req.params.shopId,
                isActive: true,
            }).lean();
            if (!p) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: p });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── BUYURTMA BERISH ──────────────────────────────────────────────────────
    // POST /api/webapp/:shopId/orders
    r.post("/:shopId/orders", async (req, res) => {
        try {
            const { clientName, clientPhone, clientNote, items } = req.body;
            const shopId = req.params.shopId;

            if (!clientName?.trim() || !clientPhone?.trim())
                return res.status(400).json({ ok: false, error: "Ism va telefon kerak" });
            if (!items?.length)
                return res.status(400).json({ ok: false, error: "Mahsulot tanlanmagan" });

            const shop = await Shop.findById(shopId).lean();
            if (!shop?.webApp?.enabled)
                return res.status(403).json({ ok: false, error: "Do'kon veb-sayti faol emas" });

            // Narxlarni DB dan tekshirish
            const productIds = items.map(it => it.productId).filter(Boolean);
            const products   = await Product.find({
                _id: { $in: productIds }, shopId, isActive: true
            }).lean();
            const pMap = new Map(products.map(p => [String(p._id), p]));

            let total = 0;
            const orderItems = items.map(it => {
                const p   = pMap.get(String(it.productId));
                const qty = Math.max(1, parseInt(it.qty) || 1);
                const price = p?.price || it.price || 0;
                const sum   = price * qty;
                total += sum;
                return { productId: it.productId, name: p?.name || it.name, price, qty, total: sum };
            });

            const order = await Order.create({
                shopId, clientName: clientName.trim(),
                clientPhone: clientPhone.trim(),
                clientNote: clientNote?.trim() || "",
                items: orderItems, total,
            });

            // Do'kon egasiga Telegram xabar
            await notifyOwner(shop, order, bot => bot);
            await Shop.updateOne({ _id: shopId }, { $inc: { "webApp.totalOrders": 1 } });

            res.status(201).json({ ok: true, data: {
                orderId: order._id,
                total,
                message: "Buyurtmangiz qabul qilindi! Tez orada bog'lanamiz.",
            }});
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── BANNER YANGILASH (do'kon egasi) ─────────────────────────────────────
    // PUT /api/webapp/:shopId/banner
    r.put("/:shopId/banner", async (req, res) => {
        try {
            const { bannerUrl } = req.body;
            await Shop.updateOne({ _id: req.params.shopId }, { "webApp.bannerUrl": bannerUrl || "" });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── BUYURTMALAR RO'YXATI (do'kon egasi) ─────────────────────────────────
    // GET /api/webapp/:shopId/orders
    r.get("/:shopId/orders", async (req, res) => {
        try {
            const { page = 1, limit = 20, status } = req.query;
            const filter = { shopId: req.params.shopId };
            if (status) filter.status = status;

            const [orders, total] = await Promise.all([
                Order.find(filter).sort({ createdAt: -1 })
                    .skip((+page - 1) * +limit).limit(+limit).lean(),
                Order.countDocuments(filter),
            ]);
            res.json({ ok: true, data: { orders, total } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // PATCH /api/webapp/:shopId/orders/:id/status
    r.patch("/:shopId/orders/:id/status", async (req, res) => {
        try {
            const { status } = req.body;
            const order = await Order.findOneAndUpdate(
                { _id: req.params.id, shopId: req.params.shopId },
                { status }, { new: true }
            );
            if (!order) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: order });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    return r;
}

// ─── DO'KON EGASIGA XABAR ────────────────────────────────────────────────────
async function notifyOwner(shop, order) {
    try {
        const chatId = shop.webApp?.orderChatId || shop.groupChatId;
        if (!chatId) return;

        const bot = getBot(shop._id);
        if (!bot) return;

        const lines = order.items
            .map(it => `• ${it.name} x${it.qty} — ${formatMoney(it.total)} so'm`)
            .join("\n");

        const text = [
            `🛒 <b>YANGI BUYURTMA!</b>`,
            ``,
            `👤 ${order.clientName}`,
            `📞 <a href="tel:${order.clientPhone}">${order.clientPhone}</a>`,
            order.clientNote ? `📝 ${order.clientNote}` : "",
            ``,
            lines,
            ``,
            `💰 Jami: <b>${formatMoney(order.total)} so'm</b>`,
        ].filter(x => x !== undefined && x !== null && x !== "").join("\n");

        const msg = await bot.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [[
                { text: "✅ Tasdiqlash", callback_data: `order_confirm:${order._id}` },
                { text: "❌ Bekor",     callback_data: `order_cancel:${order._id}` },
            ]]}
        });

        // Message ID saqlash (keyinchalik tahrirlash uchun)
        if (msg?.message_id) {
            await Order.updateOne({ _id: order._id }, {
                tgMsgId:  msg.message_id,
                tgChatId: chatId,
            });
        }
    } catch (e) {
        console.error("[notifyOwner]", e.message);
    }
}

module.exports = { webappRoutes };
