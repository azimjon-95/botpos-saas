// src/routes/webapp.js — Web App API (do'kon sayt)
"use strict";
const express = require("express");
const mongoose = require("mongoose");
const Shop    = require("../models/Shop");
const Product = require("../models/Product");
const Order   = require("../models/Order");
const { getCatalog } = require("../services/catalogCache");
const { getOrFetch }  = require("../utils/cache");
const { getBot }     = require("../saas/botManager");
const { adminAuth }  = require("../middlewares/adminAuth");
const { formatMoney } = require("../utils/money");

function webappRoutes() {
    const r = express.Router();

    // ─── SHOP INFO ────────────────────────────────────────────────────────────
    // GET /api/webapp/:shopId
    r.get("/:shopId", async (req, res) => {
        try {
            const shop = await getOrFetch(
                `webapp:shop:${req.params.shopId}`,
                () => Shop.findById(req.params.shopId)
                    .select("name webApp webappUrl billing.status isActive sector plan")
                    .lean(),
                120  // 2 daqiqa
            );

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
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // ─── KATALOG ──────────────────────────────────────────────────────────────
    // GET /api/webapp/:shopId/catalog
    r.get("/:shopId/catalog", async (req, res) => {
        try {
            const catalog = await getCatalog(req.params.shopId);
            res.json({ ok: true, data: catalog });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // ─── CHEK — sotuv ma'lumotlari ──────────────────────────────────────────
    // GET /api/webapp/:shopId/sale/:saleId
    r.get("/:shopId/sale/:saleId", async (req, res) => {
        try {
            const Sale = require("../models/Sale");
            const sale = await Sale.findOne({
                _id:    req.params.saleId,
                shopId: req.params.shopId,
            }).lean();
            if (!sale) return res.status(404).json({ ok: false, error: "Chek topilmadi" });
            res.json({ ok: true, data: sale });
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
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
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

            // Telefon format tekshiruvi (O'zbekiston)
            const phone = clientPhone.trim().replace(/\s/g, "");
            if (!/^(\+998|998)?[0-9]{9}$/.test(cleanedPhone))
                return res.status(400).json({ ok: false, error: "Telefon formati noto'g'ri. Masalan: +998901234567" });

            // Ism uzunligi
            if (clientName.trim().length < 2 || clientName.trim().length > 100)
                return res.status(400).json({ ok: false, error: "Ism 2-100 belgi orasida bo'lishi kerak" });

            // Items soni cheklash
            if (items.length > 50)
                return res.status(400).json({ ok: false, error: "Bir buyurtmada maksimal 50 ta mahsulot" });

            // Telefon format tekshiruvi (O'zbekiston: +998 yoki 998 bilan boshlanadi)
            const cleanedPhone = String(clientPhone).replace(/\s/g, "");
            if (!/^(\+?998)?[0-9]{9}$/.test(phone)) {
                return res.status(400).json({ ok: false, error: "Telefon raqam noto'g'ri (998901234567)" });
            }

            // Ism uzunligi
            if (clientName.trim().length < 2 || clientName.trim().length > 80) {
                return res.status(400).json({ ok: false, error: "Ism 2-80 belgi bo'lishi kerak" });
            }

            // Items soni cheklov (spam himoya)
            if (items.length > 50) {
                return res.status(400).json({ ok: false, error: "Maksimal 50 ta mahsulot" });
            }

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
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // ─── BANNER YANGILASH (do'kon egasi) ─────────────────────────────────────
    // PUT /api/webapp/:shopId/banner — FAQAT admin (JWT kerak)
    r.put("/:shopId/banner", adminAuth, async (req, res) => {
        try {
            const { bannerUrl } = req.body;
            // URL format tekshiruvi
            if (bannerUrl && !/^https?:\/\/.+/.test(bannerUrl)) {
                return res.status(400).json({ ok: false, error: "bannerUrl to'g'ri URL bo'lishi kerak" });
            }
            // URL uzunligi
            if (bannerUrl && bannerUrl.length > 500) {
                return res.status(400).json({ ok: false, error: "bannerUrl juda uzun" });
            }
            await Shop.updateOne({ _id: req.params.shopId }, { "webApp.bannerUrl": bannerUrl || "" });
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // ─── BUYURTMALAR RO'YXATI (do'kon egasi) ─────────────────────────────────
    // GET /api/webapp/:shopId/orders
    r.get("/:shopId/orders", adminAuth, async (req, res) => {
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
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // PATCH /api/webapp/:shopId/orders/:id/status (FAQAT ADMIN)
    r.patch("/:shopId/orders/:id/status", adminAuth, async (req, res) => {
        try {
            const { status } = req.body;
            const order = await Order.findOneAndUpdate(
                { _id: req.params.id, shopId: req.params.shopId },
                { status }, { new: true }
            );
            if (!order) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: order });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
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
