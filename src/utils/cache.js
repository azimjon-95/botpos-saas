// src/utils/cache.js
// Cache-aside pattern: Redis → yo'q/xato bo'lsa → MongoDB
// Dastur hech qachon to'xtamaydi
"use strict";

let _redis = null;

function getRedis() {
    if (_redis) return _redis;
    try {
        const Redis   = require("ioredis");
        const { REDIS_URL } = require("../config");
        if (!REDIS_URL) return null;
        _redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 0,
            retryStrategy:      () => null,
            lazyConnect:        true,
            enableOfflineQueue: false,
            connectTimeout:     2000,
        });
        _redis.on("error", () => {}); // suppress
        return _redis;
    } catch {
        return null;
    }
}

// ─── GET: Redis → DB fallback ─────────────────────────────────────────────────
async function cacheGet(key) {
    try {
        const r = getRedis();
        if (!r) return null;
        const val = await Promise.race([
            r.get(key),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 300)),
        ]);
        return val ? JSON.parse(val) : null;
    } catch {
        return null; // Redis xato — null qaytaradi, DB ga o'tadi
    }
}

// ─── SET: Redis ga yozish (xato bo'lsa o'tkazib ketadi) ──────────────────────
async function cacheSet(key, value, ttlSec = 300) {
    try {
        const r = getRedis();
        if (!r) return;
        await Promise.race([
            r.set(key, JSON.stringify(value), "EX", ttlSec),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 300)),
        ]);
    } catch {} // xato bo'lsa — jim o'tamiz
}

// ─── DELETE: kesh tozalash ────────────────────────────────────────────────────
async function cacheDel(...keys) {
    try {
        const r = getRedis();
        if (!r || !keys.length) return;
        await Promise.race([
            r.del(...keys),
            new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 300)),
        ]);
    } catch {}
}

// ─── GET OR FETCH: asosiy pattern ────────────────────────────────────────────
// Ishlatish: const data = await getOrFetch("key", () => DB.find(...), 300)
async function getOrFetch(key, fetchFn, ttlSec = 300) {
    // 1. Redis dan olishga harakat
    const cached = await cacheGet(key);
    if (cached !== null) return cached;

    // 2. DB dan olish
    const data = await fetchFn();

    // 3. Redis ga yozish (background, kutmaymiz)
    if (data !== null && data !== undefined) {
        cacheSet(key, data, ttlSec).catch(() => {});
    }

    return data;
}

module.exports = { cacheGet, cacheSet, cacheDel, getOrFetch };
