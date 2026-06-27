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
    const key = `catalog:${shopId}`;
    return getOrFetch(key,
        () => _fetchFromDB(shopId),
        CATALOG_TTL
    );
}

async function _fetchFromDB(shopId) {
    const oid  = new mongoose.Types.ObjectId(String(shopId));
    const docs = await Product.find({ shopId: oid, isActive: true })
        .sort({ category: 1, name: 1 }).lean();

    const grouped = {};
    for (const p of docs) {
        const cat = p.category || "Boshqa";
        if (!grouped[cat]) grouped[cat] = { category: cat, emoji: p.emoji || "🛍", items: [] };
        grouped[cat].items.push(p);
    }
    return Object.values(grouped);
}

async function invalidateCatalog(shopId) {
    await cacheDel(`catalog:${shopId}`);
}

module.exports = { getCatalog, invalidateCatalog };
