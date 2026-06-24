// src/services/backupScheduler.js
// Har do'kon uchun alohida scheduler
// Kassa yopilganda + har kuni 23:30 da
"use strict";
const schedule = require("node-schedule");
const Shop     = require("../models/Shop");
const { sendBackup } = require("./backup");
const { getBot }     = require("../saas/botManager");

const TZ = "Asia/Tashkent";

// Bir kunda bir marta yuborildi deb belgilash
const _sentToday = new Map(); // shopId → "2025-06-24"

function todayStr() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

// ─── BITTA DO'KON BACKUP ─────────────────────────────────────────────────────
async function backupShop(shopId) {
    const today = todayStr();
    if (_sentToday.get(String(shopId)) === today) {
        return { ok: false, reason: "Bugun yuborilgan" };
    }

    const bot = getBot(shopId);
    if (!bot) return { ok: false, reason: "Bot topilmadi" };

    const result = await sendBackup(bot, shopId);
    if (result.ok) _sentToday.set(String(shopId), today);
    return result;
}

// ─── KASSA YOPILGANDA (closeCash.js chaqiradi) ───────────────────────────────
async function triggerOnClose(shopId) {
    return backupShop(shopId).catch(e =>
        console.error(`[backup] triggerOnClose xato:`, e.message)
    );
}

// ─── HAR KUNI 23:30 DA BARCHA FAOL DO'KONLAR ────────────────────────────────
function startBackupScheduler() {
    schedule.scheduleJob({ hour: 23, minute: 30, tz: TZ }, async () => {
        console.log("[backup] ⏰ 23:30 — backup boshlanmoqda...");
        try {
            const shops = await Shop.find({
                isActive: true,
                $or: [
                    { backupChatId: { $ne: null } },
                    { groupChatId:  { $ne: ""  } },
                ],
            }).select("_id name").lean();

            console.log(`[backup] ${shops.length} ta do'kon uchun backup`);

            for (const shop of shops) {
                await backupShop(shop._id).catch(() => {});
                // Bot spamdan himoya — 2 soniya oraliq
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            console.error("[backup] scheduler xato:", e.message);
        }
    });

    console.log("✅ Backup scheduler: har kuni 23:30 (Toshkent)");
}

// ─── QO'LDA BACKUP (admin buyrug'i) ─────────────────────────────────────────
async function manualBackup(shopId) {
    _sentToday.delete(String(shopId)); // limitni olib tashlash
    return backupShop(shopId);
}

module.exports = { startBackupScheduler, triggerOnClose, manualBackup };
