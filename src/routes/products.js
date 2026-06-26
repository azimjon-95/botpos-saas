// src/routes/products.js — Mahsulotlar katalogi API
// Admin: CRUD
// WebApp (sotuvchi): kategoriyalar + mahsulotlar ro'yxati
"use strict";
const express = require("express");
const Product = require("../models/Product");
const { adminAuth } = require("../middlewares/adminAuth");
const { shopGuard } = require("../middlewares/shopGuard");

// ─── DEFAULT KATEGORIYALAR (yangi do'kon uchun namuna) ────────────────────────
const DEFAULT_CATEGORIES = [
    { category: "Tortlar",      emoji: "🎂", products: [
        { name: "Napoleon tort",    price: 140000, unit: "dona" },
        { name: "Medovik tort",     price: 130000, unit: "dona" },
        { name: "Shokoladli tort",  price: 150000, unit: "dona" },
        { name: "Mevali tort",      price: 160000, unit: "dona" },
        { name: "Bento tort",       price: 70000,  unit: "dona" },
        { name: "Mini tort",        price: 50000,  unit: "dona" },
    ]},
    { category: "Pirojniylar",  emoji: "🧁", products: [
        { name: "Ekler",            price: 12000, unit: "dona" },
        { name: "Profiterol",       price: 10000, unit: "dona" },
        { name: "Shokoladli keks",  price: 8000,  unit: "dona" },
        { name: "Vanil keks",       price: 8000,  unit: "dona" },
        { name: "Macaroon",         price: 7000,  unit: "dona" },
    ]},
    { category: "Ichimliklar",  emoji: "🥤", products: [
        { name: "Pepsi 0.5L",       price: 10000, unit: "dona" },
        { name: "Coca-Cola 0.5L",   price: 10000, unit: "dona" },
        { name: "Lipton choy",      price: 8000,  unit: "dona" },
        { name: "Espresso",         price: 12000, unit: "dona" },
        { name: "Kapuchino",        price: 15000, unit: "dona" },
        { name: "Limonad",          price: 20000, unit: "litr" },
    ]},
    { category: "Non-Pishloq",  emoji: "🥐", products: [
        { name: "Kruasan",          price: 12000, unit: "dona" },
        { name: "Sambusa",          price: 5000,  unit: "dona" },
        { name: "Somsa",            price: 5000,  unit: "dona" },
        { name: "Lavash",           price: 3000,  unit: "dona" },
    ]},
    { category: "Sovg'alar",    emoji: "🎁", products: [
        { name: "Konfet qutisi",    price: 80000,  unit: "dona" },
        { name: "Shokolad to'plam", price: 120000, unit: "dona" },
        { name: "Rasm tort",        price: 200000, unit: "dona" },
    ]},
];

function productRoutes() {
    const r = express.Router();

    // ═══ ADMIN ENDPOINTS (JWT talab) ═════════════════════════════════════════

    // GET /api/admin/shops/:shopId/products
    r.get("/shops/:shopId/products", adminAuth, async (req, res) => {
        try {
            const products = await Product.find({ shopId: req.params.shopId })
                .sort({ category: 1, sortOrder: 1, createdAt: 1 }).lean();

            // Kategoriya bo'yicha guruhlash
            const grouped = {};
            for (const p of products) {
                if (!grouped[p.category]) grouped[p.category] = { emoji: p.emoji, items: [] };
                grouped[p.category].items.push(p);
            }
            res.json({ ok: true, data: { grouped, flat: products, total: products.length } });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // POST /api/admin/shops/:shopId/products — yangi mahsulot
    r.post("/shops/:shopId/products", adminAuth, async (req, res) => {
        try {
            const { name, price, category, emoji, unit, sortOrder } = req.body;
            if (!name || !price || !category)
                return res.status(400).json({ ok: false, error: "name, price, category kerak" });

            const product = await Product.create({
                shopId: req.params.shopId,
                name: name.trim(), price: Number(price),
                category: category.trim(),
                emoji: emoji || "🛍",
                unit: unit || "dona",
                sortOrder: Number(sortOrder) || 0,
            });
            res.status(201).json({ ok: true, data: product });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // PUT /api/admin/shops/:shopId/products/:id — tahrirlash
    r.put("/shops/:shopId/products/:id", adminAuth, async (req, res) => {
        try {
            const allowed = ["name","price","category","emoji","unit","isActive","sortOrder"];
            const update = {};
            for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];

            const p = await Product.findOneAndUpdate(
                { _id: req.params.id, shopId: req.params.shopId },
                update, { new: true }
            );
            if (!p) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: p });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // DELETE /api/admin/shops/:shopId/products/:id
    r.delete("/shops/:shopId/products/:id", adminAuth, async (req, res) => {
        try {
            await Product.deleteOne({ _id: req.params.id, shopId: req.params.shopId });
            res.json({ ok: true, message: "O'chirildi" });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // POST /api/admin/shops/:shopId/products/seed — default mahsulotlarni yuklash
    r.post("/shops/:shopId/products/seed", adminAuth, async (req, res) => {
        try {
            const shopId = req.params.shopId;
            const existing = await Product.countDocuments({ shopId });
            if (existing > 0)
                return res.status(409).json({ ok: false, error: `Allaqachon ${existing} ta mahsulot bor. Avval o'chiring.` });

            const docs = [];
            for (const cat of DEFAULT_CATEGORIES) {
                for (const p of cat.products) {
                    docs.push({ shopId, category: cat.category, emoji: cat.emoji, ...p });
                }
            }
            await Product.insertMany(docs);
            res.json({ ok: true, data: { count: docs.length, message: "Default mahsulotlar yuklandi" } });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    // ═══ WEBAPP ENDPOINTS (shopGuard + Telegram auth) ════════════════════════

    // GET /api/webapp/products — katalog (sotuvchi uchun)
    r.get("/webapp/products", shopGuard, async (req, res) => {
        try {
            const products = await Product.find({ shopId: req.shopId, isActive: true })
                .sort({ category: 1, sortOrder: 1 }).lean();

            const grouped = {};
            for (const p of products) {
                if (!grouped[p.category]) {
                    grouped[p.category] = { emoji: p.emoji, category: p.category, items: [] };
                }
                grouped[p.category].items.push({
                    _id: p._id, name: p.name, price: p.price, unit: p.unit,
                });
            }
            res.json({ ok: true, data: Object.values(grouped) });
        } catch (e) { res.status(500).json({ ok: false, error: process.env.NODE_ENV === "production" ? "Server xatosi" : e.message }); }
    });

    return r;
}

// Default kategoriyalar export (seed uchun)
module.exports = { productRoutes, DEFAULT_CATEGORIES };
