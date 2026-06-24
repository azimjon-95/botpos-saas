// src/services/backup.js — SaaS backup
// Har do'kon o'z backupChatId ga yuboradi
// Kassa yopilganda + har kuni 23:30 da
"use strict";
const fs   = require("fs");
const os   = require("os");
const path = require("path");

const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Debt     = require("../models/Debt");
const Worker   = require("../models/Worker");
const Customer = require("../models/Customer");
const Counter  = require("../models/Counter");
const Supplier = require("../models/Supplier");
const Product  = require("../models/Product");
const Payment  = require("../models/Payment");
const Shop     = require("../models/Shop");

const COLLECTIONS = [
    { name: "sales",     Model: Sale },
    { name: "expenses",  Model: Expense },
    { name: "debts",     Model: Debt },
    { name: "workers",   Model: Worker },
    { name: "customers", Model: Customer },
    { name: "counters",  Model: Counter },
    { name: "suppliers", Model: Supplier },
    { name: "products",  Model: Product },
    { name: "payments",  Model: Payment },
];

// ─── BACKUP YARATISH ──────────────────────────────────────────────────────────
async function buildBackup(shopId) {
    const shop = await Shop.findById(shopId).select("name plan sector").lean();
    const backup = {
        meta: {
            shopId:    String(shopId),
            shopName:  shop?.name || "Noma'lum",
            plan:      shop?.plan || "starter",
            createdAt: new Date().toISOString(),
            version:   "2.0",
        },
        data: {},
    };

    let totalDocs = 0;
    for (const { name, Model } of COLLECTIONS) {
        try {
            const docs = await Model.find({ shopId }).lean();
            backup.data[name] = docs;
            totalDocs += docs.length;
        } catch (e) {
            backup.data[name] = [];
            backup.meta[`${name}_error`] = e.message;
        }
    }
    backup.meta.totalDocuments = totalDocs;
    return backup;
}

// ─── TELEGRAM GA YUBORISH ─────────────────────────────────────────────────────
async function sendBackup(bot, shopId) {
    const shop = await Shop.findById(shopId)
        .select("name backupChatId groupChatId").lean();

    const chatId = shop?.backupChatId || shop?.groupChatId;
    if (!chatId) {
        console.warn(`[backup] ${shop?.name}: backupChatId yo'q`);
        return { ok: false, reason: "chatId yo'q" };
    }

    const now     = new Date();
    const pad     = v => String(v).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const shopSlug = (shop?.name || "shop").replace(/\s+/g, "_").toLowerCase();
    const fileName = `${shopSlug}_backup_${dateStr}_${timeStr}.json`;
    const tmpPath  = path.join(os.tmpdir(), fileName);

    try {
        const backup = await buildBackup(shopId);
        const json   = JSON.stringify(backup, null, 2);
        fs.writeFileSync(tmpPath, json, "utf8");

        const total = backup.meta.totalDocuments;
        const lines = Object.entries(backup.data)
            .filter(([,v]) => v.length > 0)
            .map(([k,v]) => `• ${k}: ${v.length} ta`)
            .join("\n");

        const caption =
            `📦 <b>${shop?.name} — DB Backup</b>\n\n` +
            `📅 Sana: <b>${dateStr}</b>\n` +
            `🕐 Vaqt: <b>${timeStr.replace("-",":")}</b>\n` +
            `📊 Jami hujjatlar: <b>${total}</b>\n` +
            `📁 Fayl: <code>${fileName}</code>\n\n` +
            lines;

        await bot.sendDocument(
            chatId, tmpPath,
            { caption, parse_mode: "HTML" },
            { filename: fileName, contentType: "application/json" }
        );

        console.log(`[backup] ✅ ${shop?.name}: ${fileName} (${total} docs)`);
        return { ok: true, fileName, total };

    } catch (e) {
        console.error(`[backup] ${shop?.name}:`, e.message);
        return { ok: false, reason: e.message };
    } finally {
        try { fs.unlinkSync(tmpPath); } catch {}
    }
}

// ─── TIKLASH ─────────────────────────────────────────────────────────────────
async function restoreFromFile(filePath, targetShopId) {
    const raw = fs.readFileSync(filePath, "utf8");
    const bk  = JSON.parse(raw);
    if (!bk?.data) throw new Error("Noto'g'ri backup format");

    const shopId = targetShopId || bk.meta?.shopId;
    if (!shopId) throw new Error("shopId kerak");

    const results = {};
    for (const { name, Model } of COLLECTIONS) {
        const docs = bk.data[name];
        if (!Array.isArray(docs) || !docs.length) {
            results[name] = { skipped: true };
            continue;
        }
        try {
            // shopId ni yangilash (boshqa shopId ga tiklash uchun)
            const patched = docs.map(d => ({ ...d, shopId }));
            const res = await Model.insertMany(patched, {
                ordered: false, rawResult: false,
            }).catch(e => ({
                insertedCount: docs.length - (e?.writeErrors?.length || 0),
            }));
            results[name] = { total: docs.length, inserted: res?.insertedCount ?? docs.length };
        } catch (e) {
            results[name] = { error: e.message };
        }
    }
    return results;
}

module.exports = { sendBackup, restoreFromFile, buildBackup };
