// src/services/catalogCache.js
// Redis cache — katalog tez yuklanadi (loading yo'q)
// TTL: 30 daqiqa. Mahsulot qo'shilsa/o'chirilsa — cache tozalanadi
"use strict";
const Product = require("../models/Product");
const mongoose = require("mongoose");

const CACHE_TTL = 60 * 30; // 30 daqiqa

// ─── REDIS ───────────────────────────────────────────────────────────────────
let _redis = null;
function getRedis() {
    try {
        if (!_redis) {
            const Redis = require("ioredis");
            const { REDIS_URL } = require("../config");
            if (!REDIS_URL) return null;
            _redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: () => null });
            _redis.on("error", () => { _redis = null; });
        }
        return _redis;
    } catch { return null; }
}

function cacheKey(shopId) { return `catalog:${shopId}`; }

// ─── DB DAN KATALOG YUKLASH ───────────────────────────────────────────────────
async function loadFromDB(shopId) {
    const oid = typeof shopId === "string"
        ? new mongoose.Types.ObjectId(shopId)
        : shopId;

    const products = await Product.find({ shopId: oid, isActive: true })
        .sort({ category: 1, sortOrder: 1, name: 1 })
        .select("category emoji name price unit _id")
        .lean();

    // Kategoriya bo'yicha guruhlash
    const grouped = {};
    for (const p of products) {
        if (!grouped[p.category]) {
            grouped[p.category] = { category: p.category, emoji: p.emoji || "🛍", items: [] };
        }
        grouped[p.category].items.push({
            _id:   String(p._id),
            name:  p.name,
            price: p.price,
            unit:  p.unit || "dona",
        });
    }
    return Object.values(grouped); // [{ category, emoji, items[] }]
}

// ─── KATALOGNI CACHE DAN YOKI DB DAN OLISH ───────────────────────────────────
async function getCatalog(shopId) {
    const r = getRedis();
    const key = cacheKey(String(shopId));

    // 1. Redis dan tekshir
    if (r) {
        try {
            const cached = await r.get(key);
            if (cached) return JSON.parse(cached);
        } catch {}
    }

    // 2. DB dan yukla
    const data = await loadFromDB(shopId);

    // 3. Cache ga yoz
    if (r && data.length) {
        r.set(key, JSON.stringify(data), "EX", CACHE_TTL).catch(() => {});
    }
    return data;
}

// ─── CACHE TOZALASH (mahsulot o'zgarganda) ───────────────────────────────────
async function invalidateCache(shopId) {
    const r = getRedis();
    if (r) {
        try { await r.del(cacheKey(String(shopId))); } catch {}
    }
}

// ─── MAHSULOT QO'SHISH (cache yangilaydi) ────────────────────────────────────
async function addProduct(shopId, { category, emoji, name, price, unit }) {
    // Kategoriya emoji — avval borini olish yoki yangi
    if (!emoji) {
        const existing = await Product.findOne({ shopId, category }).lean();
        emoji = existing?.emoji || "🛍";
    }

    // Mavjud mahsulot bormi?
    const dup = await Product.findOne({ shopId, category, name }).lean();
    if (dup) throw new Error(`"${name}" allaqachon bor!`);

    const count = await Product.countDocuments({ shopId, category });
    const p = await Product.create({
        shopId, category: category.trim(), emoji,
        name: name.trim(), price: Number(price),
        unit: unit || "dona", sortOrder: count,
    });
    await invalidateCache(shopId);
    return p;
}

// ─── MAHSULOT O'CHIRISH ───────────────────────────────────────────────────────
async function deleteProduct(shopId, productId) {
    await Product.deleteOne({ _id: productId, shopId });
    await invalidateCache(shopId);
}

// ─── KATEGORIYA O'CHIRISH (ichidagi barchasi bilan) ──────────────────────────
async function deleteCategory(shopId, category) {
    const { deletedCount } = await Product.deleteMany({ shopId, category });
    await invalidateCache(shopId);
    return deletedCount;
}

// ─── MAHSULOT NARXINI YANGILASH ───────────────────────────────────────────────
async function updateProductPrice(shopId, productId, newPrice) {
    await Product.updateOne({ _id: productId, shopId }, { price: Number(newPrice) });
    await invalidateCache(shopId);
}

// ─── KATEGORIYA NOMI / EMOJI YANGILASH ───────────────────────────────────────
async function updateCategory(shopId, oldName, { newName, emoji }) {
    const upd = {};
    if (newName) upd.category = newName.trim();
    if (emoji)   upd.emoji   = emoji;
    await Product.updateMany({ shopId, category: oldName }, upd);
    await invalidateCache(shopId);
}

module.exports = {
    getCatalog,
    invalidateCache,
    addProduct,
    deleteProduct,
    deleteCategory,
    updateProductPrice,
    updateCategory,
};
