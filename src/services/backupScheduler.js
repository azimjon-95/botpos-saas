// src/services/backupScheduler.js
// 1. Har kuni 23:00 — backup yuborish, OLDIN eskisini o'chirish
// 2. Har kuni 09:00 — kecha yuborilganmi? Yo'q bo'lsa ogohlantirish
// 3. Message ID — Redis yoki DB da saqlanadi (o'chirish uchun)
"use strict";
const schedule           = require("node-schedule");
const { sendFullBackup } = require("./backup");
const { getStatus, getBot } = require("../saas/botManager");

const TZ = "Asia/Tashkent";

// ─── STATE (server restart bo'lsa yo'qoladi → Redis bilan saqlaymiz) ─────────
let _state = {
    lastBackupDate:    "",   // "2026-06-24"
    lastBackupMsgId:   null, // Telegram message_id
    lastBackupChatId:  null, // Telegram chat_id
    lastBackupOk:      false,
};

// Redis dan state yuklash
async function loadState() {
    try {
        const Redis = require("ioredis");
        const { REDIS_URL } = require("../config");
        if (!REDIS_URL) return;
        const r = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: () => null });
        const raw = await r.get("backup:state").catch(() => null);
        if (raw) _state = { ..._state, ...JSON.parse(raw) };
        await r.quit().catch(() => {});
    } catch {}
}

// Redis ga state saqlash
async function saveState() {
    try {
        const Redis = require("ioredis");
        const { REDIS_URL } = require("../config");
        if (!REDIS_URL) return;
        const r = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: () => null });
        await r.set("backup:state", JSON.stringify(_state), "EX", 60 * 60 * 48).catch(() => {});
        await r.quit().catch(() => {});
    } catch {}
}

function todayStr() {
    return new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
}

function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}

// ─── ISTALGAN AKTIV BOT ───────────────────────────────────────────────────────
function getAnyBot() {
    // 1. Aktiv botlardan
    for (const s of getStatus()) {
        if (s.botActive) {
            const bot = getBot(s.shopId);
            if (bot) return bot;
        }
    }
    // 2. ADMIN_NOTIFICATION_BOT_TOKEN bilan
    const { ADMIN_NOTIFICATION_BOT_TOKEN } = require("../config");
    if (ADMIN_NOTIFICATION_BOT_TOKEN) {
        const TelegramBot = require("node-telegram-bot-api");
        return new TelegramBot(ADMIN_NOTIFICATION_BOT_TOKEN, { polling: false });
    }
    return null;
}

// ─── ESKI FAYLNI O'CHIRISH ────────────────────────────────────────────────────
async function deleteOldBackup(bot) {
    const { lastBackupMsgId, lastBackupChatId } = _state;
    if (!lastBackupMsgId || !lastBackupChatId) return;
    try {
        await bot.deleteMessage(lastBackupChatId, lastBackupMsgId);
        console.log(`[backup] 🗑 Eski fayl o'chirildi (msg_id: ${lastBackupMsgId})`);
        _state.lastBackupMsgId  = null;
        _state.lastBackupChatId = null;
        await saveState();
    } catch (e) {
        // 48 soatdan eski xabarni o'chirib bo'lmaydi (Telegram cheklov)
        console.warn(`[backup] Eski faylni o'chirib bo'lmadi: ${e.message}`);
    }
}

// ─── BACKUP YUBORISH ──────────────────────────────────────────────────────────
async function runBackup(force = false) {
    const today = todayStr();

    if (!force && _state.lastBackupDate === today) {
        return { ok: false, reason: "Bugun allaqachon yuborilgan" };
    }

    const bot = getAnyBot();
    if (!bot) {
        return { ok: false, reason: "Bot topilmadi. ADMIN_NOTIFICATION_BOT_TOKEN qo'ying." };
    }

    // 1. Eski faylni o'chiramiz
    await deleteOldBackup(bot);

    // 2. Yangi backup yuboramiz
    const result = await sendFullBackup(bot);

    if (result.ok) {
        // 3. Yangi message_id saqlaymiz
        _state.lastBackupDate   = today;
        _state.lastBackupMsgId  = result.messageId  || null;
        _state.lastBackupChatId = result.chatId     || null;
        _state.lastBackupOk     = true;
        await saveState();
        console.log(`[backup] ✅ Yuborildi: ${result.fileName} | msg_id: ${result.messageId}`);
    } else {
        _state.lastBackupOk = false;
        await saveState();
        console.warn(`[backup] ❌ Yuborilmadi: ${result.reason}`);
    }

    return result;
}

// ─── 23:00 — BACKUP ──────────────────────────────────────────────────────────
function scheduleBackup() {
    schedule.scheduleJob({ hour: 23, minute: 0, tz: TZ }, async () => {
        console.log("[backup] ⏰ 23:00 — backup boshlanmoqda...");
        try {
            await runBackup();
        } catch (e) {
            console.error("[backup] ❌", e.message);
            _state.lastBackupOk = false;
            await saveState();
        }
    });
    console.log("✅ Backup scheduler: 23:00 (Toshkent)");
}

// ─── 09:00 — OGOHLANTIRISH (kecha yuborilmagan bo'lsa) ───────────────────────
function scheduleWarning() {
    schedule.scheduleJob({ hour: 9, minute: 0, tz: TZ }, async () => {
        const yesterday = yesterdayStr();

        // Kecha yuborilganmi?
        if (_state.lastBackupDate === yesterday && _state.lastBackupOk) {
            console.log("[backup] 09:00 tekshiruv: kecha yuborilgan ✅");
            return;
        }

        // YUBORILMAGAN — ogohlantirish
        console.warn("[backup] ⚠️ 09:00: kecha backup yuborilmagan!");

        const bot = getAnyBot();
        if (!bot) return;

        const { BACKUP_CHAT_ID } = require("../config");
        const chatId = BACKUP_CHAT_ID;
        if (!chatId) return;

        try {
            await bot.sendMessage(chatId,
                `🚨 <b>BACKUP YUBORILMADI!</b>\n\n` +
                `📅 Kecha (${yesterday}) kungi backup topilmadi.\n\n` +
                `Sabab: server o'chib qolgan yoki bot xato.\n\n` +
                `✅ Qo'lda yuborish:\n` +
                `Admin panel → Backup → "Hozir yuborish"`,
                { parse_mode: "HTML" }
            );
        } catch (e) {
            console.error("[backup] ogohlantirish xato:", e.message);
        }
    });
    console.log("✅ Backup warning: 09:00 (Toshkent)");
}

// ─── START ───────────────────────────────────────────────────────────────────
async function startBackupScheduler() {
    await loadState(); // Redis dan eski state ni yuklash
    scheduleBackup();
    scheduleWarning();
}

// ─── QO'LDA BACKUP ───────────────────────────────────────────────────────────
async function manualBackup() {
    return runBackup(true);
}

module.exports = { startBackupScheduler, manualBackup };
