// src/services/openaiService.js
// Markaziy OpenAI xizmati — barcha do'konlar uchun bitta key
// Har so'rov shopId bilan loglanadi
"use strict";
const { OPENAI_API_KEY, OPENAI_MODEL } = require("../config");
const Shop = require("../models/Shop");
const dayjs = require("dayjs");

// ─── NARX ($/1K token, gpt-4o-mini) ──────────────────────────────────────────
const PRICE_PER_1K_INPUT  = 0.000150;   // $0.00015
const PRICE_PER_1K_OUTPUT = 0.000600;   // $0.00060

// ─── DO'KON AI SARFINI YANGILASH ─────────────────────────────────────────────
async function logUsage(shopId, inputTokens, outputTokens) {
    if (!shopId) return;
    const month = dayjs().format("YYYY-MM");
    const totalNew = inputTokens + outputTokens;
    const costUSD = (inputTokens / 1000) * PRICE_PER_1K_INPUT
                  + (outputTokens / 1000) * PRICE_PER_1K_OUTPUT;
    try {
        const shop = await Shop.findById(shopId, "aiUsage").lean();
        const lastMonth = shop?.aiUsage?.lastResetMonth || "";

        const update = {
            $inc: {
                "aiUsage.totalTokens":   totalNew,
                "aiUsage.totalRequests": 1,
                "aiUsage.thisMonthTokens":   lastMonth === month ? totalNew : 0,
                "aiUsage.thisMonthRequests": lastMonth === month ? 1        : 0,
                "aiUsage.estimatedCostUSD":  costUSD,
            },
        };

        // Oy o'zgarganda — reset
        if (lastMonth !== month) {
            update.$set = {
                "aiUsage.thisMonthTokens":   totalNew,
                "aiUsage.thisMonthRequests": 1,
                "aiUsage.lastResetMonth":    month,
            };
        }

        await Shop.updateOne({ _id: shopId }, update);
    } catch {}
}

// ─── ASOSIY AI SO'ROV FUNKSIYASI ─────────────────────────────────────────────
async function chat({ shopId, system, user, maxTokens = 150, json = false }) {
    if (!OPENAI_API_KEY) return null;

    const body = {
        model:       OPENAI_MODEL || "gpt-4o-mini",
        max_tokens:  maxTokens,
        temperature: 0,
        messages: [
            { role: "system", content: system },
            { role: "user",   content: user },
        ],
    };
    if (json) body.response_format = { type: "json_object" };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type":  "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`OpenAI ${resp.status}: ${err?.error?.message || "xato"}`);
    }

    const data = await resp.json();
    const content     = data?.choices?.[0]?.message?.content?.trim() || "";
    const inputTokens  = data?.usage?.prompt_tokens     || 0;
    const outputTokens = data?.usage?.completion_tokens || 0;

    // Do'kon sarfini loglash (async, xato bo'lsa ham davom etamiz)
    logUsage(shopId, inputTokens, outputTokens).catch(() => {});

    return { content, inputTokens, outputTokens };
}

// ─── SOTUV MATNINI PARSE QILISH ──────────────────────────────────────────────
async function parseSaleAI(text, shopId) {
    if (!OPENAI_API_KEY || !text) return null;
    try {
        const res = await chat({
            shopId,
            system: `Siz sotuv xabarini parse qiluvchi yordamchisiz.
Foydalanuvchi xabarini standart formatga o'tkaz:
"Mahsulot N_ta NARX"
Misol: "ikkita tort yetmish ming, pepsi on yetti" → "Tort 2ta 70000, Pepsi 1ta 17000"
Faqat parse natijasini qaytaring. Hech qanday izoh yo'q.`,
            user: text,
            maxTokens: 120,
        });
        return res?.content || null;
    } catch (e) {
        console.error("[openAI parseSale]", e.message);
        return null;
    }
}

// ─── CHIQIM MATNINI PARSE QILISH ─────────────────────────────────────────────
async function parseExpenseAI(text, shopId) {
    if (!OPENAI_API_KEY || !text) return null;
    try {
        const res = await chat({
            shopId,
            system: `Chiqim xabarini JSON ga o'tkaz.
Kategoriyalar: rent, electricity, supplier, worker, food, taxi, repair, bank, cash, other
Javob: {"categoryKey":"...","amount":NUMBER,"description":"..."}
Faqat JSON. Boshqa narsa yo'q.`,
            user: text,
            maxTokens: 100,
            json: true,
        });
        if (!res?.content) return null;
        return JSON.parse(res.content);
    } catch (e) {
        console.error("[openAI parseExpense]", e.message);
        return null;
    }
}

// ─── JAMI AI SARFI STATISTIKASI ──────────────────────────────────────────────
async function getSystemUsageStats() {
    const month = dayjs().format("YYYY-MM");
    const shops = await Shop.find(
        { "aiUsage.totalTokens": { $gt: 0 } },
        "name plan aiUsage"
    ).lean();

    const totals = shops.reduce((a, s) => ({
        tokens:   a.tokens   + (s.aiUsage?.totalTokens || 0),
        requests: a.requests + (s.aiUsage?.totalRequests || 0),
        costUSD:  a.costUSD  + (s.aiUsage?.estimatedCostUSD || 0),
        thisMonthTokens: a.thisMonthTokens + (
            s.aiUsage?.lastResetMonth === month ? (s.aiUsage?.thisMonthTokens || 0) : 0
        ),
    }), { tokens: 0, requests: 0, costUSD: 0, thisMonthTokens: 0 });

    return { totals, shops };
}

module.exports = { chat, parseSaleAI, parseExpenseAI, getSystemUsageStats, logUsage };
