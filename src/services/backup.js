// src/services/backup.js
// BUTUN DB backup — barcha do'konlar, barcha kolleksiyalar
// Har kuni 23:00 da bir marta admin chat ga yuboriladi
// Kassa yopishda YUBORILMAYDI
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");

// Barcha modellar
const Shop     = require("../models/Shop");
const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Debt     = require("../models/Debt");
const Worker   = require("../models/Worker");
const Customer = require("../models/Customer");
const Counter  = require("../models/Counter");
const Supplier = require("../models/Supplier");
const Product  = require("../models/Product");
const Payment  = require("../models/Payment");
const AuditLog = require("../models/AuditLog");

const COLLECTIONS = [
    { name: "shops",     Model: Shop },
    { name: "sales",     Model: Sale },
    { name: "expenses",  Model: Expense },
    { name: "debts",     Model: Debt },
    { name: "workers",   Model: Worker },
    { name: "customers", Model: Customer },
    { name: "counters",  Model: Counter },
    { name: "suppliers", Model: Supplier },
    { name: "products",  Model: Product },
    { name: "payments",  Model: Payment },
    { name: "auditlogs", Model: AuditLog },
];

// ─── BUTUN DB NI JSON GA YOZISH ──────────────────────────────────────────────
async function buildFullBackup() {
    const now = new Date();
    const backup = {
        meta: {
            type:      "full_db_backup",
            createdAt: now.toISOString(),
            version:   "2.0",
            tz:        "Asia/Tashkent",
        },
        data: {},
        stats: {},
    };

    let totalDocs = 0;
    for (const { name, Model } of COLLECTIONS) {
        try {
            const docs = await Model.find().lean();
            backup.data[name]  = docs;
            backup.stats[name] = docs.length;
            totalDocs += docs.length;
        } catch (e) {
            backup.data[name]  = [];
            backup.stats[name] = 0;
            backup.meta[`${name}_error`] = e.message;
        }
    }

    backup.meta.totalDocuments = totalDocs;
    backup.meta.shopCount = backup.stats.shops || 0;
    return backup;
}

// ─── ADMIN CHAT GA YUBORISH ───────────────────────────────────────────────────
// bot — istalgan aktiv bot (birinchi topilgani)
async function sendFullBackup(bot) {
    const { BACKUP_CHAT_ID } = require("../config");
    if (!BACKUP_CHAT_ID) {
        console.warn("[backup] BACKUP_CHAT_ID yo'q — .env ga qo'shing");
        return { ok: false, reason: "BACKUP_CHAT_ID yo'q" };
    }

    const now     = new Date();
    const pad     = v => String(v).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const fileName = `botpos_full_backup_${dateStr}_${timeStr}.json`;
    const tmpPath  = path.join(os.tmpdir(), fileName);

    let backup;
    try {
        backup = await buildFullBackup();
    } catch (e) {
        console.error("[backup] buildFullBackup xato:", e.message);
        return { ok: false, reason: e.message };
    }

    try {
        fs.writeFileSync(tmpPath, JSON.stringify(backup, null, 2), "utf8");

        const total = backup.meta.totalDocuments;
        const shops = backup.meta.shopCount;

        // Caption — eski bot kabi ko'rinish
        const statsLines = Object.entries(backup.stats)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `• ${k}: ${v} ta`)
            .join("\n");

        const caption =
            `📦 <b>BOT·POS — To'liq DB Backup</b>\n\n` +
            `📅 Sana: <b>${dateStr}</b>\n` +
            `🕐 Vaqt: <b>${timeStr.replace("-", ":")}</b>\n` +
            `🏪 Do'konlar: <b>${shops} ta</b>\n` +
            `📊 Jami hujjatlar: <b>${total}</b>\n` +
            `📁 <code>${fileName}</code>\n\n` +
            statsLines;

        const sentMsg = await bot.sendDocument(
            BACKUP_CHAT_ID,
            tmpPath,
            { caption, parse_mode: "HTML" },
            { filename: fileName, contentType: "application/json" }
        );

        // message_id — eski faylni o'chirish uchun kerak
        const messageId = sentMsg?.message_id || null;
        const chatId    = sentMsg?.chat?.id   || BACKUP_CHAT_ID;

        console.log(`[backup] ✅ ${fileName} yuborildi (${total} docs, ${shops} do'kon, msg_id: ${messageId})`);
        return { ok: true, fileName, total, shops, messageId, chatId };

    } catch (e) {
        console.error("[backup] sendDocument xato:", e.message);
        return { ok: false, reason: e.message };
    } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
    }
}

// ─── DB NI TIKLASH — JSON FAYLDAN ────────────────────────────────────────────
// Admin panel orqali JSON fayl yuklanadi → bu funksiya ishlaydi
async function restoreFromJson(jsonData) {
    // jsonData — parse qilingan JS object (JSON.parse dan keyin)
    if (!jsonData?.data) throw new Error("Noto'g'ri backup format. 'data' maydoni yo'q.");

    const results = {};
    let totalInserted = 0;

    for (const { name, Model } of COLLECTIONS) {
        const docs = jsonData.data[name];
        if (!Array.isArray(docs) || docs.length === 0) {
            results[name] = { skipped: true, count: 0 };
            continue;
        }

        try {
            // _id conflict bo'lsa o'tkazib ketish (ordered: false)
            const res = await Model.insertMany(docs, {
                ordered:   false,
                rawResult: false,
            }).catch(e => {
                const dupCount = e?.writeErrors?.length || 0;
                return { insertedCount: docs.length - dupCount };
            });

            const inserted = res?.insertedCount ?? docs.length;
            results[name]   = { total: docs.length, inserted };
            totalInserted  += inserted;

        } catch (e) {
            results[name] = { error: e.message, count: 0 };
        }
    }

    return { results, totalInserted };
}

module.exports = { buildFullBackup, sendFullBackup, restoreFromJson };
