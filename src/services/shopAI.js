// src/services/shopAI.js
// Do'kon uchun ChatGPT — soha va katalogga qarab ishlaydi
// Sotuv, chiqim, savol — hammasini tushunatdi
"use strict";
const { OPENAI_API_KEY, OPENAI_MODEL, OPENAI_WHISPER_MODEL } = require("../config");
const Shop    = require("../models/Shop");
const Sale    = require("../models/Sale");
const dayjs   = require("dayjs");

// Token narxi (gpt-4o-mini)
const PRICE_INPUT  = 0.000150 / 1000;
const PRICE_OUTPUT = 0.000600 / 1000;
const PRICE_WHISPER = 0.006; // $/min

// ─── SEKTOR TAVSIF ───────────────────────────────────────────────────────────
const SECTOR_DESC = {
    tort_va_shirinlik: "Tort va shirinlik do'koni. Mahsulotlar: tortlar, pirojniylar, ichimliklar, aksessuarlar.",
    kafe_restoran:     "Kafe yoki restoran. Mahsulotlar: taomlar, ichimliklar, shirinliklar.",
    supermarket:       "Supermarket yoki oziq-ovqat do'koni. Mahsulotlar: oziq-ovqat, ichimliklar, maishiy tovarlar.",
    kiyim:             "Kiyim-kechak do'koni. Mahsulotlar: kiyim, poyabzal, aksessuarlar.",
    elektronika:       "Elektronika do'koni. Mahsulotlar: telefon, kompyuter, elektronika va aksessuarlar.",
    kosmetika:         "Kosmetika va go'zallik do'koni. Mahsulotlar: krem, parfyum, makiyaj, sochni parvarish.",
    dori_darmon:       "Dorixona. Mahsulotlar: dorilar, vitaminlar, tibbiy buyumlar.",
    qurilish:          "Qurilish materiallari do'koni. Mahsulotlar: sement, bo'yoq, quvur, elektr materiallari.",
    sport:             "Sport mahsulotlari do'koni. Mahsulotlar: sport kiyim, asbob-uskunalar.",
    boshqa:            "Savdo do'koni.",
};

// ─── USAGE LOG ───────────────────────────────────────────────────────────────
async function logUsage(shopId, inp, out, whisperMin = 0) {
    if (!shopId) return;
    const month  = dayjs().format("YYYY-MM");
    const tokens = inp + out;
    const cost   = inp * PRICE_INPUT + out * PRICE_OUTPUT + whisperMin * PRICE_WHISPER;
    try {
        const s = await Shop.findById(shopId, "aiUsage").lean();
        const same = s?.aiUsage?.lastResetMonth === month;
        const upd = {
            $inc: {
                "aiUsage.totalTokens":      tokens,
                "aiUsage.totalRequests":    1,
                "aiUsage.estimatedCostUSD": cost,
                ...(same ? { "aiUsage.thisMonthTokens": tokens, "aiUsage.thisMonthRequests": 1 } : {}),
            },
            $set: { "aiConfig.lastAiRequestAt": new Date(),
                    ...(!same ? { "aiUsage.thisMonthTokens": tokens, "aiUsage.thisMonthRequests": 1, "aiUsage.lastResetMonth": month } : {}) },
        };
        await Shop.updateOne({ _id: shopId }, upd);
    } catch {}
}

// ─── RATE LIMIT ───────────────────────────────────────────────────────────────
async function checkRate(shopId) {
    if (!OPENAI_API_KEY) return { ok: false, reason: "Servisda AI kaliti yo'q" };
    try {
        const s = await Shop.findById(shopId, "aiConfig aiUsage").lean();
        const cfg = s?.aiConfig || {};
        const minSec = cfg.minIntervalSec || 1;
        if (cfg.lastAiRequestAt) {
            const ago = (Date.now() - new Date(cfg.lastAiRequestAt)) / 1000;
            if (ago < minSec) return { ok: false, reason: `⏳ ${Math.ceil(minSec - ago)}s kuting` };
        }
        return { ok: true };
    } catch { return { ok: true }; }
}

// ─── WHISPER STT ──────────────────────────────────────────────────────────────
async function stt(audioBuffer, shopId, sector) {
    if (!OPENAI_API_KEY) return null;
    try {
        const desc = SECTOR_DESC[sector] || SECTOR_DESC.boshqa;
        const formData = new FormData();
        formData.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "v.ogg");
        formData.append("model",    OPENAI_WHISPER_MODEL || "whisper-1");
        formData.append("language", "uz");
        formData.append("prompt",   `${desc} O'zbek tilida narxlar so'mda.`);

        const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method:  "POST",
            headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
            body:    formData,
        });
        if (!r.ok) return null;
        const d = await r.json();
        logUsage(shopId, 0, 0, 0.2).catch(() => {});
        return d?.text?.trim() || null;
    } catch (e) {
        console.error("[STT]", e.message);
        return null;
    }
}

// ─── ASOSIY CHAT — DO'KON AI ─────────────────────────────────────────────────
// Katalog, bugungi sotuv, saldo — hammasi kontekst sifatida beriladi
async function shopChat({ shopId, sector, userMsg, catalog = [], history = [], balance = 0, todaySales = 0 }) {
    if (!OPENAI_API_KEY) return null;

    const sectorDesc = SECTOR_DESC[sector] || SECTOR_DESC.boshqa;

    // Katalog matni (token uchun qisqacha)
    const catalogText = catalog.length
        ? catalog.map(g =>
            `${g.emoji} ${g.category}: ${g.items.map(p => `${p.name}(${p.price.toLocaleString()})`).join(", ")}`
          ).join("\n")
        : "Katalog yo'q";

    // SYSTEM PROMPT — soha + katalog + vazifa
    const system = `Sen "${sectorDesc}" uchun aqlli savdo yordamchisisan.

KATALOG:
${catalogText}

BUGUNGI HOLAT:
- Balans: ${balance.toLocaleString()} so'm
- Bugungi sotuv: ${todaySales.toLocaleString()} so'm

VAZIFALARING:
1. SOTUV PARSE — foydalanuvchi sotuv yozsа yoki gapirsа:
   Format javob: JSON {"type":"sale","items":[{"name":"...","qty":1,"price":0,"paid":0}],"phone":null}
   Katalogdagi mahsulot nomlaridan foydalanish.
   "Berdi" so'zi → paid summasi. "Tel" → phone.

2. CHIQIM PARSE — "arenda", "elektr", "maosh" kabi so'zlar:
   Format javob: JSON {"type":"expense","categoryKey":"rent","amount":0,"description":"..."}
   Kategoriyalar: rent,electricity,supplier,worker,food,taxi,repair,bank,cash,other

3. SAVOLLAR — balans, qarz, bugun qancha sotdik, mahsulot narxi:
   Oddiy matn javob. Qisqa va aniq.

4. BOSHQA — do'kon bilan ALOQASI YO'Q savollar:
   {"type":"off_topic","reply":"Kechirasiz, men faqat do'kon ishlariga yordam beraman."}

MUHIM:
- Javob FAQAT JSON (sotuv/chiqim uchun) yoki oddiy matn (savol uchun).
- Sotuv/chiqim ANIQLANMASA — oddiy matn bilan so'ra.
- O'zbek tilida javob ber.
- Qisqa bo'l.`;

    // Tarix (oxirgi 4 xabar)
    const msgs = [
        { role: "system", content: system },
        ...history.slice(-4),
        { role: "user", content: userMsg },
    ];

    try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type":  "application/json",
            },
            body: JSON.stringify({
                model:       OPENAI_MODEL || "gpt-4o-mini",
                messages:    msgs,
                max_tokens:  250,
                temperature: 0.2,
            }),
        });

        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            throw new Error(e?.error?.message || r.status);
        }

        const d   = await r.json();
        const out = d?.choices?.[0]?.message?.content?.trim() || "";
        const inp = d?.usage?.prompt_tokens     || 0;
        const ot  = d?.usage?.completion_tokens || 0;
        logUsage(shopId, inp, ot).catch(() => {});

        return out;
    } catch (e) {
        console.error("[shopAI]", e.message);
        return null;
    }
}

// ─── JAVOBNI PARSE QILISH ─────────────────────────────────────────────────────
function parseAIResponse(raw) {
    if (!raw) return { type: "text", text: null };

    // JSON bo'lsa
    try {
        const clean = raw.replace(/```json|```/g, "").trim();
        if (clean.startsWith("{")) {
            const obj = JSON.parse(clean);
            return obj;
        }
    } catch {}

    return { type: "text", text: raw };
}

// ─── BUGUNGI SOTUV JAMI ───────────────────────────────────────────────────────
async function getTodaySales(shopId) {
    try {
        const start = dayjs().startOf("day").toDate();
        const r = await Sale.aggregate([
            { $match: { shopId: new (require("mongoose").Types.ObjectId)(String(shopId)), createdAt: { $gte: start } } },
            { $group: { _id: null, total: { $sum: "$paidTotal" } } },
        ]);
        return r?.[0]?.total || 0;
    } catch { return 0; }
}

// ─── STATISTIKA ───────────────────────────────────────────────────────────────
async function getUsageStats() {
    const month = dayjs().format("YYYY-MM");
    const shops = await Shop.find({ "aiUsage.totalTokens": { $gt: 0 } }, "name plan sector aiUsage").lean();
    const totals = shops.reduce((a, s) => ({
        tokens:   a.tokens   + (s.aiUsage?.totalTokens    || 0),
        requests: a.requests + (s.aiUsage?.totalRequests   || 0),
        costUSD:  a.costUSD  + (s.aiUsage?.estimatedCostUSD || 0),
        thisMonth: a.thisMonth + (s.aiUsage?.lastResetMonth === month ? (s.aiUsage?.thisMonthTokens || 0) : 0),
    }), { tokens: 0, requests: 0, costUSD: 0, thisMonth: 0 });
    return { totals, shops };
}

function getSectorList() {
    return Object.entries(SECTOR_DESC).map(([key, desc]) => ({
        key, label: desc.split(".")[0],
    }));
}

module.exports = { stt, shopChat, parseAIResponse, getTodaySales, getUsageStats, getSectorList, logUsage, checkRate };
