// src/services/backupScheduler.js
// Har kuni 23:00 da bir marta — butun DB backup
// Kassa yopishda YUBORILMAYDI
"use strict";
const schedule         = require("node-schedule");
const { sendFullBackup } = require("./backup");
const { getStatus }    = require("../saas/botManager");
const { getBot }       = require("../saas/botManager");

const TZ = "Asia/Tashkent";

let _lastBackupDate = ""; // "2026-06-24" — bir kunda bir marta

function todayStr() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

// Birinchi aktiv botni topish (backup yuborish uchun)
function getAnyActiveBot() {
    const list = getStatus();
    for (const s of list) {
        if (s.botActive) {
            const bot = getBot(s.shopId);
            if (bot) return bot;
        }
    }
    return null;
}

// ─── BACKUP YUBORISH ─────────────────────────────────────────────────────────
async function runBackup(force = false) {
    const today = todayStr();

    if (!force && _lastBackupDate === today) {
        console.log("[backup] Bugun allaqachon yuborilgan:", today);
        return { ok: false, reason: "Bugun yuborilgan" };
    }

    const bot = getAnyActiveBot();
    if (!bot) {
        // Bot yo'q — Telegram API to'g'ridan ishlatish
        const { BACKUP_CHAT_ID, ADMIN_NOTIFICATION_BOT_TOKEN } = require("../config");
        if (ADMIN_NOTIFICATION_BOT_TOKEN && BACKUP_CHAT_ID) {
            const TelegramBot = require("node-telegram-bot-api");
            const adminBot = new TelegramBot(ADMIN_NOTIFICATION_BOT_TOKEN, { polling: false });
            const result = await sendFullBackup(adminBot);
            if (result.ok) _lastBackupDate = today;
            return result;
        }
        console.warn("[backup] Aktiv bot topilmadi");
        return { ok: false, reason: "Aktiv bot yo'q" };
    }

    const result = await sendFullBackup(bot);
    if (result.ok) _lastBackupDate = today;
    return result;
}

// ─── SCHEDULER — HAR KUNI 23:00 ──────────────────────────────────────────────
function startBackupScheduler() {
    schedule.scheduleJob({ hour: 23, minute: 0, tz: TZ }, async () => {
        console.log("[backup] ⏰ 23:00 — Butun DB backup boshlanmoqda...");
        try {
            const result = await runBackup();
            if (result.ok) {
                console.log(`[backup] ✅ Yuborildi: ${result.fileName} (${result.total} docs)`);
            } else {
                console.warn(`[backup] ⚠️ Yuborilmadi: ${result.reason}`);
            }
        } catch (e) {
            console.error("[backup] ❌ Xato:", e.message);
        }
    });

    console.log("✅ Backup scheduler: har kuni 23:00 (Toshkent)");
}

// ─── QO'LDA BACKUP (admin /backup buyrug'i yoki admin panel) ─────────────────
async function manualBackup() {
    return runBackup(true); // force = true (bugun yuborilgan bo'lsa ham)
}

module.exports = { startBackupScheduler, manualBackup };
