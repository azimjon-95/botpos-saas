// src/services/openaiService.js — Markaziy OpenAI (token tejash + soha bo'yicha prompt)
"use strict";
const { OPENAI_API_KEY, OPENAI_MODEL, OPENAI_WHISPER_MODEL } = require("../config");
const Shop  = require("../models/Shop");
const dayjs = require("dayjs");

// ─── NARX (gpt-4o-mini) ──────────────────────────────────────────────────────
const PRICE = {
    INPUT:   0.000150,   // $0.00015 / 1K token
    OUTPUT:  0.000600,   // $0.00060 / 1K token
    WHISPER: 0.006,      // $0.006 / daqiqa
};

// ─── SOHA BO'YICHA MAHSULOT MISOLLARI ────────────────────────────────────────
// GPT ga qisqaroq, aniqroq prompt berish uchun
// Har soha — o'z mahsulot nomlari va narx oralig'i
const SECTOR_HINTS = {
    tort_va_shirinlik: {
        label:    "Tort va shirinlik do'koni",
        examples: "Tort 140000, Bento 70000, Ekler 2ta 12000, Pepsi 18000",
        priceRange: "5000–500000",
        units: "dona, kg",
    },
    kafe_restoran: {
        label:    "Kafe / Restoran",
        examples: "Kapuchino 25000, Lavash 35000, Shashlik 2ta 45000, Choy 8000",
        priceRange: "3000–200000",
        units: "dona, porsiya",
    },
    supermarket: {
        label:    "Supermarket",
        examples: "Non 5000, Sut 1L 15000, Yog 2ta 25000, Shakar 1kg 22000",
        priceRange: "1000–500000",
        units: "dona, kg, litr, pachka",
    },
    kiyim: {
        label:    "Kiyim-kechak",
        examples: "Ko'ylak 150000, Shim 200000, Bola kiyimi 2ta 180000",
        priceRange: "20000–2000000",
        units: "dona, juft",
    },
    elektronika: {
        label:    "Elektronika",
        examples: "Kabel 25000, Naushnik 180000, Zaryadka 2ta 45000",
        priceRange: "10000–10000000",
        units: "dona",
    },
    kosmetika: {
        label:    "Kosmetika",
        examples: "Krem 85000, Parfyum 250000, Tuş 2ta 45000",
        priceRange: "5000–1000000",
        units: "dona, ml",
    },
    dori_darmon: {
        label:    "Dorixona",
        examples: "Paracetamol 12000, Vitamin C 25000, Krem 45000",
        priceRange: "3000–500000",
        units: "dona, quti, ml",
    },
    qurilish: {
        label:    "Qurilish materiallari",
        examples: "Sement 5qop 180000, Bo'yoq 10kg 120000, Vint 100ta 25000",
        priceRange: "1000–5000000",
        units: "dona, qop, kg, metr",
    },
    sport: {
        label:    "Sport mahsulotlari",
        examples: "To'p 180000, Forma 250000, Qo'lqop 2ta 85000",
        priceRange: "10000–3000000",
        units: "dona, juft",
    },
    boshqa: {
        label:    "Do'kon",
        examples: "Mahsulot 50000, Tovar 2ta 30000",
        priceRange: "100–10000000",
        units: "dona",
    },
};

// ─── DO'KON AI SARFINI YANGILASH ─────────────────────────────────────────────
async function logUsage(shopId, inputTokens, outputTokens, whisperMinutes = 0) {
    if (!shopId) return;
    const month    = dayjs().format("YYYY-MM");
    const tokens   = inputTokens + outputTokens;
    const costUSD  = (inputTokens  / 1000) * PRICE.INPUT
                   + (outputTokens / 1000) * PRICE.OUTPUT
                   + whisperMinutes * PRICE.WHISPER;

    try {
        const shop = await Shop.findById(shopId, "aiUsage").lean();
        const sameMonth = shop?.aiUsage?.lastResetMonth === month;
        const update = {
            $inc: {
                "aiUsage.totalTokens":    tokens,
                "aiUsage.totalRequests":  1,
                "aiUsage.estimatedCostUSD": costUSD,
                ...(sameMonth ? {
                    "aiUsage.thisMonthTokens":   tokens,
                    "aiUsage.thisMonthRequests": 1,
                } : {}),
            },
        };
        if (!sameMonth) {
            update.$set = {
                "aiUsage.thisMonthTokens":   tokens,
                "aiUsage.thisMonthRequests": 1,
                "aiUsage.lastResetMonth":    month,
            };
        }
        // Oxirgi so'rov vaqti (rate limit uchun)
        update.$set = { ...(update.$set || {}), "aiConfig.lastAiRequestAt": new Date() };
        await Shop.updateOne({ _id: shopId }, update);
    } catch {}
}

// ─── TOKEN LIMIT TEKSHIRUVI ───────────────────────────────────────────────────
async function checkLimits(shopId) {
    if (!shopId || !OPENAI_API_KEY) return { allowed: false, reason: "no_key" };

    try {
        const shop = await Shop.findById(shopId, "aiConfig aiUsage").lean();
        if (!shop) return { allowed: false, reason: "no_shop" };

        const cfg   = shop.aiConfig || {};
        const usage = shop.aiUsage  || {};

        // Oylik limit tekshiruvi
        const limit = cfg.monthlyTokenLimit || 50000;
        const used  = usage.thisMonthTokens || 0;
        if (limit > 0 && used >= limit) {
            return { allowed: false, reason: "limit_reached", used, limit };
        }

        // Rate limit: minIntervalSec
        const minSec = cfg.minIntervalSec || 2;
        const lastAt = cfg.lastAiRequestAt;
        if (lastAt) {
            const secAgo = (Date.now() - new Date(lastAt).getTime()) / 1000;
            if (secAgo < minSec) {
                return { allowed: false, reason: "rate_limit", waitSec: Math.ceil(minSec - secAgo) };
            }
        }

        return { allowed: true };
    } catch {
        return { allowed: true }; // Xato bo'lsa ruxsat beramiz
    }
}

// ─── ASOSIY CHAT FUNKSIYASI ───────────────────────────────────────────────────
async function chat({ shopId, system, user, maxTokens = 100 }) {
    if (!OPENAI_API_KEY) return null;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type":  "application/json",
        },
        body: JSON.stringify({
            model:       OPENAI_MODEL || "gpt-4o-mini",
            max_tokens:  maxTokens,
            temperature: 0,
            messages: [
                { role: "system", content: system },
                { role: "user",   content: user },
            ],
        }),
    });

    if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error(`OpenAI ${resp.status}: ${e?.error?.message || "xato"}`);
    }

    const data = await resp.json();
    const content      = data?.choices?.[0]?.message?.content?.trim() || "";
    const inputTokens  = data?.usage?.prompt_tokens     || 0;
    const outputTokens = data?.usage?.completion_tokens || 0;

    logUsage(shopId, inputTokens, outputTokens).catch(() => {});
    return content;
}

// ─── SOTUV PARSE (TOKEN TEJASH UCHUN OPTIMALLASHTIRILGAN) ────────────────────
async function parseSaleAI(rawText, shopId, sector = "boshqa") {
    if (!OPENAI_API_KEY || !rawText?.trim()) return null;

    const check = await checkLimits(shopId);
    if (!check.allowed) {
        console.log(`[AI] ${shopId} — skip: ${check.reason}`);
        return null;
    }

    const hint = SECTOR_HINTS[sector] || SECTOR_HINTS.boshqa;

    // QISQA PROMPT — minimal token sarflash
    const system = `${hint.label} uchun sotuv parse qil.
Format: "Nom [Nta] Narx" — vergul bilan ajrat.
Narx oralig'i: ${hint.priceRange} so'm.
Misol: "${hint.examples}"
FAQAT parse natijasini qaytار. Izoh yo'q.`;

    try {
        const result = await chat({ shopId, system, user: rawText.trim(), maxTokens: 80 });
        return result || null;
    } catch (e) {
        console.error("[parseSaleAI]", e.message);
        return null;
    }
}

// ─── OVOZ → MATN ──────────────────────────────────────────────────────────────
// Telegram o'zining STT ni ishlatamiz (BEPUL)
// Whisper faqat Telegram STT ishlamagan holda zaxira
async function transcribeVoice(bot, fileId, shopId) {
    try {
        // Telegram Bot API: getFile → file_path
        // Telegram o'zi ovozni matn ga aylantiradi (voice xabar)
        // Bu funksiya esa fayl URL ni qaytaradi — faqat kerak bo'lsa Whisper uchun
        const fileInfo = await bot.getFile(fileId);
        return { fileInfo, fileUrl: null }; // Telegram STT ishlatiladi
    } catch (e) {
        console.error("[STT]", e.message);
        return null;
    }
}

// ─── WHISPER (faqat zaxira, Telegram STT ishlamasa) ───────────────────────────
// Oyiga ~$0.42 (Telegram STT) vs ~$34 (Whisper) — 99% tejash
async function whisperFallback(audioBuffer, shopId, sector = "boshqa") {
    if (!OPENAI_API_KEY) return null;
    const check = await checkLimits(shopId);
    if (!check.allowed) return null;
    const hint = SECTOR_HINTS[sector] || SECTOR_HINTS.boshqa;
    try {
        const { Blob } = globalThis;
        const formData = new FormData();
        formData.append("file", new Blob([audioBuffer], { type:"audio/ogg" }), "voice.ogg");
        formData.append("model", OPENAI_WHISPER_MODEL || "whisper-1");
        formData.append("language", "uz");
        formData.append("prompt",
            `${hint.label}. ${hint.examples.split(",").map(e=>e.trim().split(" ")[0]).join(", ")}.`
        );
        const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method:"POST", headers:{ "Authorization": `Bearer ${OPENAI_API_KEY}` }, body: formData,
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        logUsage(shopId, 0, 0, 0.17).catch(()=>{}); // ~10s = 0.17 min
        return data?.text?.trim() || null;
    } catch { return null; }
}

// ─── OVOZLI SOTUV — TELEGRAM STT + SMART PARSE ──────────────────────────────
// STRATEGIYA (99% token tejash):
// 1. Telegram voice → msg.voice (Telegram BEPUL STT qiladi — caption/text sifatida)
//    LEKIN: Telegram bot API da voice text yo'q. Shuning uchun:
//    msg.voice.file_id → getFile → URL → Whisper (faqat kerak bo'lsa)
//
// ASOSIY TEJASH:
// 1. Avval regex parser — 70-80% holatda yetadi (0 token)
// 2. Katalog bilan solishtirish — mos kelib qolsa AI yo'q
// 3. AI faqat tushunilmaganda — oyiga ~33,000 ovozdan 10,000 tasi AI kerak = $4/oy
async function processVoiceSale(sttText, shopId, sector, catalogItems = []) {
    // sttText — Telegram STT dan (whisper ishlatilmaydi)
    if (!sttText?.trim()) return { text: null, items: null };

    const { parseSaleText } = require("../services/saleParser");

    // QADAM 1: Oddiy regex parser (0 token)
    let items = parseSaleText(sttText);

    // QADAM 2: Katalog bilan boyitish (0 token)
    if (items?.length) {
        items = items.map(item => {
            const lc = item.name.toLowerCase();
            const found = catalogItems.find(c => {
                const cn = c.name.toLowerCase();
                return cn.includes(lc) || lc.includes(cn.split(" ")[0]);
            });
            if (found) {
                return {
                    ...item,
                    name:  found.name,
                    price: item.price > 0 ? item.price : found.price,
                    paid:  item.price > 0 ? item.paid  : found.price,
                };
            }
            return item;
        });
        return { text: sttText, items, aiUsed: false };
    }

    // QADAM 3: AI parse (faqat regex tushunmasa)
    const check = await checkLimits(shopId);
    if (!check.allowed) return { text: sttText, items: null, aiUsed: false };

    const normalized = await parseSaleAI(sttText, shopId, sector);
    if (!normalized) return { text: sttText, items: null, aiUsed: false };

    const aiItems = parseSaleText(normalized);
    return { text: sttText, normalized, items: aiItems, aiUsed: true };
}

// ─── CHIQIM PARSE ────────────────────────────────────────────────────────────
async function parseExpenseAI(text, shopId) {
    if (!OPENAI_API_KEY || !text?.trim()) return null;

    const check = await checkLimits(shopId);
    if (!check.allowed) return null;

    const system = `Chiqim parse. Kategoriyalar: rent,electricity,supplier,worker,food,taxi,repair,bank,cash,other
JSON: {"categoryKey":"...","amount":NUMBER,"description":"..."}
FAQAT JSON.`;

    try {
        const result = await chat({ shopId, system, user: text.trim(), maxTokens: 60 });
        if (!result) return null;
        return JSON.parse(result.replace(/```json|```/g, "").trim());
    } catch { return null; }
}

// ─── JAMI STATISTIKA ─────────────────────────────────────────────────────────
async function getSystemUsageStats() {
    const month = dayjs().format("YYYY-MM");
    const shops = await Shop.find(
        { "aiUsage.totalTokens": { $gt: 0 } },
        "name plan sector aiUsage"
    ).lean();

    const totals = shops.reduce((a, s) => ({
        tokens:   a.tokens   + (s.aiUsage?.totalTokens    || 0),
        requests: a.requests + (s.aiUsage?.totalRequests   || 0),
        costUSD:  a.costUSD  + (s.aiUsage?.estimatedCostUSD || 0),
        thisMonthTokens: a.thisMonthTokens + (
            s.aiUsage?.lastResetMonth === month ? (s.aiUsage?.thisMonthTokens || 0) : 0
        ),
    }), { tokens: 0, requests: 0, costUSD: 0, thisMonthTokens: 0 });

    return { totals, shops };
}

// ─── SOHA RO'YXATI (frontend uchun) ──────────────────────────────────────────
function getSectorList() {
    return Object.entries(SECTOR_HINTS).map(([key, val]) => ({
        key,
        label: val.label,
        examples: val.examples,
    }));
}

module.exports = {
    parseSaleAI,
    parseExpenseAI,
    transcribeVoice,
    processVoiceSale,
    getSystemUsageStats,
    getSectorList,
    checkLimits,
    SECTOR_HINTS,
};
