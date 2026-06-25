// src/saas/customerHandlers.js
// CASHBACK BOT — faqat haridorlar uchun
// Vazifalar:
//   1. /start → haridorni ro'yxatga olish + balans ko'rsatish
//   2. QR skanerlash → ball qo'shish
//   3. WebApp tugma — do'kon saytiga kirish (faqat shu bot orqali)
//   4. Referal tizimi
"use strict";
const Customer = require("../models/Customer");
const Shop     = require("../models/Shop");
const { formatMoney } = require("../utils/money");

// ─── QR FORMAT: botpos_qr_{shopId}_{amount} ──────────────────────────────────
// Do'kon kassasida chek chiqganda QR yaratiladi
// Haridor shu QRni cashback bot ga yuboradi → ball oladi

const QR_PREFIX = "botpos_qr_";

function parseQR(text) {
    if (!text?.startsWith(QR_PREFIX)) return null;
    const parts = text.slice(QR_PREFIX.length).split("_");
    if (parts.length < 2) return null;
    return {
        shopId: parts[0],
        amount: parseInt(parts[1], 10) || 0,
        saleId: parts[2] || null,
    };
}

// Ball hisobi: har 10,000 so'm uchun 1,000 so'm cashback (10%)
function calcPoints(amount, minQrPaid = 70000) {
    if (amount < minQrPaid) return 0;
    return Math.floor(amount / 10) * 100; // 1% cashback
}

// ─── ASOSIY HANDLER ──────────────────────────────────────────────────────────
function attachCustomerHandlers(bot, ctx) {
    if (!bot || !ctx) return;
    const { shopId } = ctx;

    // ── /start ────────────────────────────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const tgId   = msg.from?.id;
        const tgName = [msg.from?.first_name, msg.from?.last_name]
            .filter(Boolean).join(" ") || "Mijoz";
        if (!tgId) return;

        // Do'kon ma'lumotlari
        const shop = await Shop.findById(shopId)
            .select("name webApp webappUrl minQrPaid billing.status")
            .lean();

        // Do'kon bloklangan bo'lsa
        if (shop?.billing?.status === "blocked") {
            return bot.sendMessage(chatId,
                "⛔ Do'kon hozirda faol emas. Keyinroq urinib ko'ring."
            );
        }

        // Mijozni topish yoki yaratish
        let customer = await Customer.findOne({ shopId, tgId });
        if (!customer) {
            customer = await Customer.create({ shopId, tgId, tgName });
        } else {
            if (customer.tgName !== tgName) {
                customer.tgName = tgName;
                await customer.save();
            }
        }

        // Bloklangan
        if (customer.isBlocked) {
            return bot.sendMessage(chatId,
                "⛔ Hisobingiz vaqtincha to'xtatilgan.\n" +
                "Ma'lumot uchun do'konga murojaat qiling."
            );
        }

        const pts  = Math.floor(customer.points || 0);
        const shop_name = shop?.webApp?.siteName || shop?.name || "Do'kon";
        const webUrl    = shop?.webappUrl || "";

        const text = [
            `👋 Salom, <b>${tgName}</b>!`,
            ``,
            `🏪 <b>${shop_name}</b> ning cashback botiga xush kelibsiz!`,
            ``,
            `🎁 Sizning bonusingiz: <b>${formatMoney(pts)} so'm</b>`,
            pts > 0
                ? `\n💡 Bonusingizni keyingi xaridda ishlatishingiz mumkin!`
                : `\n💡 Xarid qiling va cashback to'plang!`,
        ].filter(Boolean).join("\n");

        const kb = { inline_keyboard: [] };

        // WebApp tugma — do'kon saytiga kirish
        if (webUrl) {
            kb.inline_keyboard.push([{
                text: `🛒 ${shop_name} — Xarid qilish`,
                web_app: { url: webUrl },
            }]);
        }

        // Balans tugma
        kb.inline_keyboard.push(
            [{ text: "🎁 Mening bonusim", callback_data: "cb:balance" }],
            [{ text: "📜 Xaridlar tarixi", callback_data: "cb:history" }],
        );

        return bot.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: kb,
        });
    });

    // ── CALLBACK QUERY ────────────────────────────────────────────────────────
    bot.on("callback_query", async (cq) => {
        const chatId = cq.message?.chat?.id;
        const tgId   = cq.from?.id;
        const data   = cq.data || "";
        await bot.answerCallbackQuery(cq.id).catch(() => {});
        if (!chatId || !tgId) return;

        const customer = await Customer.findOne({ shopId, tgId }).lean();
        if (!customer) return;

        // Balans
        if (data === "cb:balance") {
            const pts = Math.floor(customer.points || 0);
            return bot.sendMessage(chatId,
                `🎁 <b>Cashback balans</b>\n\n` +
                `💰 Bonus: <b>${formatMoney(pts)} so'm</b>\n\n` +
                `📌 Xarid qilganingizda bonusingiz avtomatik hisoblanadi.`,
                { parse_mode: "HTML" }
            );
        }

        // Tarix
        if (data === "cb:history") {
            const { Sale } = require("../models/Sale") || {};
            return bot.sendMessage(chatId,
                `📜 Xaridlar tarixi hozirda ko'rsatilmaydi.`,
            );
        }
    });

    // ── MATN — QR KODI SKANERLASH ─────────────────────────────────────────────
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const tgId   = msg.from?.id;
        const text   = String(msg.text || "").trim();
        if (!tgId || !text) return;
        if (text.startsWith("/")) return; // Buyruqlar allaqachon ishlaydi

        // QR kodi tekshirish
        const qrData = parseQR(text);
        if (!qrData) {
            // QR emas — oddiy xabar → /start ga yo'naltirish
            const shop = await Shop.findById(shopId)
                .select("name webApp webappUrl").lean();
            const webUrl = shop?.webappUrl || "";
            const kb     = webUrl
                ? { inline_keyboard: [[{
                        text: `🛒 Saytga o'tish`,
                        web_app: { url: webUrl },
                    }]]}
                : undefined;
            return bot.sendMessage(chatId,
                `💡 QR kodni skanerlash uchun kamerani oching va chekdagi QRni ushlang.\n\n` +
                `Yoki pastdagi tugmani bosib xarid qiling:`,
                { reply_markup: kb }
            );
        }

        // QR ma'lumotlar tekshirish
        if (String(qrData.shopId) !== String(shopId)) {
            return bot.sendMessage(chatId,
                "❌ Bu QR boshqa do'konga tegishli."
            );
        }

        if (!qrData.amount || qrData.amount < 1000) {
            return bot.sendMessage(chatId, "❌ QR kodi noto'g'ri.");
        }

        // Do'kon sozlamalari
        const shop = await Shop.findById(shopId)
            .select("minQrPaid name webApp webappUrl").lean();
        const minPaid = shop?.minQrPaid || 70000;

        if (qrData.amount < minPaid) {
            return bot.sendMessage(chatId,
                `⚠️ Minimal cashback summasi: <b>${formatMoney(minPaid)} so'm</b>\n` +
                `Sizning xaridingiz: ${formatMoney(qrData.amount)} so'm\n\n` +
                `Cashback olish uchun ${formatMoney(minPaid)} so'mdan ko'p xarid qiling.`,
                { parse_mode: "HTML" }
            );
        }

        // Ball hisoblash
        const earnedPoints = calcPoints(qrData.amount, minPaid);
        if (earnedPoints <= 0) {
            return bot.sendMessage(chatId, "⚠️ Bu xarid uchun cashback hisoblanmaydi.");
        }

        // Mijoz ballini yangilash
        let customer = await Customer.findOne({ shopId, tgId });
        if (!customer) {
            const tgName = [msg.from?.first_name, msg.from?.last_name]
                .filter(Boolean).join(" ") || "Mijoz";
            customer = await Customer.create({ shopId, tgId, tgName });
        }

        if (customer.isBlocked) {
            return bot.sendMessage(chatId, "⛔ Hisobingiz bloklangan.");
        }

        // Ball qo'shish
        customer.points   = (customer.points || 0) + earnedPoints;
        customer.updatedAt = new Date();
        await customer.save();

        const webUrl = shop?.webappUrl || "";
        const shopName = shop?.webApp?.siteName || shop?.name || "Do'kon";

        const replyText = [
            `✅ <b>Cashback qo'shildi!</b>`,
            ``,
            `🛒 Xarid: <b>${formatMoney(qrData.amount)} so'm</b>`,
            `🎁 Earned: <b>+${formatMoney(earnedPoints)} so'm</b>`,
            ``,
            `💰 Jami bonus: <b>${formatMoney(Math.floor(customer.points))} so'm</b>`,
        ].join("\n");

        const kb = webUrl ? { inline_keyboard: [[{
            text: `🛒 ${shopName} — Yana xarid`,
            web_app: { url: webUrl },
        }]]} : undefined;

        return bot.sendMessage(chatId, replyText, {
            parse_mode: "HTML",
            reply_markup: kb,
        });
    });

    console.log(`[cashbackBot] ✅ Ulandi: ${ctx.shop?.name || shopId}`);
}

module.exports = { attachCustomerHandlers, parseQR, calcPoints };
