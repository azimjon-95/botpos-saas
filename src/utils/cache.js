// src/utils/cache.js
// Cache-aside: Redis → timeout/xato bo'lsa → MongoDB
// Redis yo'q bo'lsa ham dastur TO'XTAMAYDI
// ECONNREFUSED log chiqarmaydi
"use strict";

let _redis      = null;
let _redisOk    = true;   // Redis ishlayaptimi?
let _lastRetry  = 0;      // Oxirgi urinish vaqti
const RETRY_MS  = 30_000; // 30 soniyada bir marta qayta ulashga harakat

function getRedis() {
    // Redis URL yo'q — ishlatmaymiz
    const { REDIS_URL } = require("../config");
    if (!REDIS_URL) return null;

    // Redis allaqachon xato berdi va 30s o'tmagan — kutamiz
    if (!_redisOk && Date.now() - _lastRetry < RETRY_MS) return null;

    if (!_redis) {
        try {
            const Redis = require("ioredis");
            _redis = new Redis(REDIS_URL, {
                maxRetriesPerRequest: 0,
                retryStrategy:        () => null, // qayta ulanmaydi
                lazyConnect:          true,
                enableOfflineQueue:   false,
                connectTimeout:       1500,
            });

            _redis.on("error", () => {
                // ECONNREFUSED va boshqa xatolarni suppres qilamiz
                _redisOk   = false;
                _lastRetry = Date.now();
            });

            _redis.on("connect", () => {
                _redisOk = true;
                console.log("[cache] Redis ulandi ✅");
            });

            _redis.on("close", () => {
                _redisOk = false;
            });
        } catch {
            return null;
        }
    }

    return _redisOk ? _redis : null;
}

// ─── GET: Redis → null (DB ga o'tadi) ────────────────────────────────────────
async function cacheGet(key) {
    try {
        const r = getRedis();
        if (!r) return null;
        const val = await Promise.race([
            r.get(key),
            new Promise((_, rej) =>
                setTimeout(() => rej(new Error("cache timeout")), 250)
            ),
        ]);
        if (val === null || val === undefined) return null;
        return JSON.parse(val);
    } catch {
        _redisOk   = false;
        _lastRetry = Date.now();
        return null; // → DB ga o'tadi
    }
}

// ─── SET: Redis ga yozish ─────────────────────────────────────────────────────
async function cacheSet(key, value, ttlSec = 300) {
    try {
        const r = getRedis();
        if (!r) return;
        await Promise.race([
            r.set(key, JSON.stringify(value), "EX", ttlSec),
            new Promise((_, rej) =>
                setTimeout(() => rej(new Error("cache timeout")), 250)
            ),
        ]);
    } catch {
        _redisOk   = false;
        _lastRetry = Date.now();
    }
}

// ─── DEL: kesh tozalash ───────────────────────────────────────────────────────
async function cacheDel(...keys) {
    try {
        const r = getRedis();
        if (!r || !keys.length) return;
        const validKeys = keys.filter(Boolean);
        if (!validKeys.length) return;
        await Promise.race([
            r.del(...validKeys),
            new Promise((_, rej) =>
                setTimeout(() => rej(new Error("cache timeout")), 250)
            ),
        ]);
    } catch {
        _redisOk   = false;
        _lastRetry = Date.now();
    }
}

// ─── GET OR FETCH: asosiy pattern ────────────────────────────────────────────
// 1. Redis dan olishga harakat (250ms timeout)
// 2. Redis yo'q / xato / miss → fetchFn() bilan DB dan oladi
// 3. DB dan kelgan data → Redis ga background da yoziladi
// key === null bo'lsa — har doim DB dan oladi (cache o'tkazib yuboriladi)
async function getOrFetch(key, fetchFn, ttlSec = 300) {
    // Cache o'chirilgan (null key) — to'g'ri DB ga
    if (!key) return fetchFn();

    // 1. Redis dan
    const cached = await cacheGet(key);
    if (cached !== null) return cached;

    // 2. DB dan
    const data = await fetchFn();

    // 3. Background da Redis ga yozamiz (kutmaymiz)
    if (data !== null && data !== undefined) {
        cacheSet(key, data, ttlSec).catch(() => {});
    }

    return data;
}

// ─── STATUS: Redis holati ─────────────────────────────────────────────────────
function cacheStatus() {
    const { REDIS_URL } = require("../config");
    if (!REDIS_URL) return { enabled: false, reason: "REDIS_URL yo'q" };
    return { enabled: true, connected: _redisOk };
}

module.exports = { cacheGet, cacheSet, cacheDel, getOrFetch, cacheStatus };
