// src/saas/customerHandlers.js — CASHBACK BOT
// 2 ta aniq vazifa:
//   1. Haridor /start → balans + [🛒 Saytga kirish] WebApp tugma
//   2. Do'kon egasi sayt yaratganda → cashback bot guruhga WebApp PIN qiladi
"use strict";
const Customer = require("../models/Customer");
const Shop     = require("../models/Shop");
const { formatMoney } = require("../utils/money");

const QR_PREFIX = "botpos_qr_";

function parseQR(text) {
    if (!text?.startsWith(QR_PREFIX)) return null;
    const parts = text.slice(QR_PREFIX.length).split("_");
    if (parts.length < 2) return null;
    return { shopId: parts[0], amount: parseInt(parts[1], 10) || 0 };
}

function calcPoints(amount) {
    return Math.floor(amount / 10000) * 1000; // Har 10k so'm → 1k so'm bonus
}

// ─── GURUHGA PIN XABAR YUBORISH (shopHandlers chaqiradi) ─────────────────────
async function pinWebAppToGroup(bot, shopId) {
    const shop = await Shop.findById(shopId)
        .select("name webApp webappUrl").lean();

    if (!shop?.webApp?.enabled || !shop?.webappUrl) {
        throw new Error("Sayt yoqilmagan yoki URL yo'q");
    }
    if (!shop?.webApp?.orderChatId) {
        throw new Error("Guruh ID belgilanmagan");
    }

    const chatId   = shop.webApp.orderChatId;
    const siteName = shop.webApp.siteName || shop.name;
    const url      = shop.webappUrl;

    const text = [
        `🛍 <b>${siteName}</b>`,
        ``,
        `✨ Mahsulotlarimizni ko'ring va buyurtma bering!`,
        `🎁 Har xariddan cashback bonus to'plang`,
        ``,
        `👇 Pastdagi tugmani bosing:`,
    ].join("\n");

    const msg = await bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[{
                text: `🛒 ${siteName} — Xarid qilish`,
                web_app: { url },
            }]],
        },
    });

    if (msg?.message_id) {
        await bot.pinChatMessage(chatId, msg.message_id, {
            disable_notification: false,
        });
    }

    return { messageId: msg?.message_id, chatId };
}

// ─── CASHBACK BOT ADMIN TEKSHIRUVI ───────────────────────────────────────────
async function checkCashbackBotAdmin(bot, chatId) {
    const botInfo = await bot.getMe();
    const member  = await bot.getChatMember(chatId, botInfo.id);
    const status  = member?.status;

    if (status !== "administrator" && status !== "creator") {
        return {
            ok: false,
            error: `Cashback bot (@${botInfo.username}) guruhda admin emas.\n` +
                   `Uni admin qiling va "Pin messages" ruxsatini bering.`,
        };
    }
    const canPin = member?.can_pin_messages !== false;
    if (!canPin) {
        return {
            ok: false,
            error: `Cashback bot (@${botInfo.username}) admin, lekin "Pin messages" ruxsati yo'q.`,
        };
    }
    return { ok: true, username: botInfo.username };
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
function attachCustomerHandlers(bot, ctx) {
    if (!bot || !ctx) return;
    const { shopId } = ctx;

    // ── /start ───────────────────────────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const tgId   = msg.from?.id;
        const tgName = [msg.from?.first_name, msg.from?.last_name]
            .filter(Boolean).join(" ") || "Mijoz";
        if (!tgId) return;

        const shop = await Shop.findById(shopId)
            .select("name webApp webappUrl minQrPaid billing.status").lean();

        if (shop?.billing?.status === "blocked") {
            return bot.sendMessage(chatId, "⛔ Do'kon hozirda faol emas.");
        }

        // Mijoz — topish yoki yaratish
        let customer = await Customer.findOneAndUpdate(
            { shopId, tgId },
            { $setOnInsert: { shopId, tgId, tgName } },
            { upsert: true, new: true }
        );
        if (customer.tgName !== tgName) {
            customer.tgName = tgName;
            await customer.save();
        }

        if (customer.isBlocked) {
            return bot.sendMessage(chatId,
                "⛔ Hisobingiz vaqtincha to'xtatilgan.\n" +
                "Do'konga murojaat qiling."
            );
        }

        const pts      = Math.floor(customer.points || 0);
        const siteName = shop?.webApp?.siteName || shop?.name || "Do'kon";
        const webUrl   = shop?.webappUrl || "";
        const hasWeb   = !!(shop?.webApp?.enabled && webUrl);

        // Xabar matni
        const text = [
            `👋 Salom, <b>${tgName}</b>!`,
            ``,
            `🏪 <b>${siteName}</b>`,
            ``,
            pts > 0
                ? `🎁 Sizning bonusingiz: <b>${formatMoney(pts)} so'm</b>`
                : `🎁 Hali bonus yo'q. Xarid qiling va to'plang!`,
            ``,
            `📱 Chekdagi QR kodni menga yuboring — bonus olasiz!`,
        ].join("\n");

        // Tugmalar
        const inline = [];

        // 1. Saytga kirish (asosiy tugma)
        if (hasWeb) {
            inline.push([{
                text: `🛒 ${siteName} — Xarid qilish`,
                web_app: { url: webUrl },
            }]);
        }

        // 2. Balans va tarix
        inline.push(
            [{ text: "🎁 Mening bonusim", callback_data: "cb:balance" }],
            [{ text: "ℹ️ Qanday ishlaydi?", callback_data: "cb:howto" }],
        );

        return bot.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: inline },
        });
    });

    // ── CALLBACK ─────────────────────────────────────────────────────────────
    bot.on("callback_query", async (cq) => {
        const chatId = cq.message?.chat?.id;
        const tgId   = cq.from?.id;
        const data   = cq.data || "";
        await bot.answerCallbackQuery(cq.id).catch(() => {});
        if (!chatId || !tgId) return;

        if (data === "cb:balance") {
            const c = await Customer.findOne({ shopId, tgId }).lean();
            const pts = Math.floor(c?.points || 0);
            return bot.sendMessage(chatId,
                `🎁 <b>Bonus hisobingiz</b>\n\n` +
                `💰 Balans: <b>${formatMoney(pts)} so'm</b>\n\n` +
                `📌 Keyingi xaridda bonusingiz avtomatik hisoblanadi.`,
                { parse_mode: "HTML" }
            );
        }

        if (data === "cb:howto") {
            const shop = await Shop.findById(shopId)
                .select("minQrPaid").lean();
            const min = shop?.minQrPaid || 70000;
            return bot.sendMessage(chatId,
                `ℹ️ <b>Cashback qanday ishlaydi?</b>\n\n` +
                `1️⃣ ${formatMoney(min)} so'mdan ko'p xarid qiling\n` +
                `2️⃣ Chekdagi QR kodni menga yuboring\n` +
                `3️⃣ Hisobingizga bonus qo'shiladi!\n\n` +
                `💡 Har <b>10,000 so'm</b> xariddan <b>1,000 so'm</b> bonus`,
                { parse_mode: "HTML" }
            );
        }
    });

    // ── QR SKANERLASH ────────────────────────────────────────────────────────
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const tgId   = msg.from?.id;
        const text   = String(msg.text || "").trim();
        if (!tgId || !text || text.startsWith("/")) return;

        const qr = parseQR(text);

        // QR emas
        if (!qr) {
            const shop   = await Shop.findById(shopId).select("webappUrl webApp").lean();
            const webUrl = shop?.webappUrl || "";
            const hasWeb = !!(shop?.webApp?.enabled && webUrl);
            return bot.sendMessage(chatId,
                `💡 Chekdagi QR kodni menga yuboring yoki` +
                `${hasWeb ? " saytga kiring:" : " do'konga boring."}`,
                hasWeb ? { reply_markup: { inline_keyboard: [[{
                    text: "🛒 Saytga o'tish",
                    web_app: { url: webUrl },
                }]]}} : {}
            );
        }

        // Boshqa do'kon QRi
        if (String(qr.shopId) !== String(shopId)) {
            return bot.sendMessage(chatId, "❌ Bu QR boshqa do'konga tegishli.");
        }

        // Summa tekshiruvi
        const shop = await Shop.findById(shopId)
            .select("minQrPaid webappUrl webApp name").lean();
        const minPaid = shop?.minQrPaid || 70000;

        if (qr.amount < minPaid) {
            return bot.sendMessage(chatId,
                `⚠️ Minimal cashback summasi: <b>${formatMoney(minPaid)} so'm</b>\n` +
                `Xaridingiz: ${formatMoney(qr.amount)} so'm\n\n` +
                `${formatMoney(minPaid)} so'mdan ko'p xarid qiling!`,
                { parse_mode: "HTML" }
            );
        }

        // Ball hisoblash
        const earned = calcPoints(qr.amount);
        if (earned <= 0) {
            return bot.sendMessage(chatId, "⚠️ Bu xarid uchun cashback hisoblanmaydi.");
        }

        // Mijoz ballini yangilash
        let customer = await Customer.findOne({ shopId, tgId });
        if (!customer) {
            const tgName = msg.from?.first_name || "Mijoz";
            customer = await Customer.create({ shopId, tgId, tgName });
        }
        if (customer.isBlocked) {
            return bot.sendMessage(chatId, "⛔ Hisobingiz bloklangan.");
        }

        customer.points    = (customer.points || 0) + earned;
        customer.updatedAt = new Date();
        await customer.save();

        const webUrl   = shop?.webappUrl || "";
        const siteName = shop?.webApp?.siteName || shop?.name || "Do'kon";
        const hasWeb   = !!(shop?.webApp?.enabled && webUrl);

        return bot.sendMessage(chatId,
            `✅ <b>Cashback qo'shildi!</b>\n\n` +
            `🛒 Xarid: <b>${formatMoney(qr.amount)} so'm</b>\n` +
            `🎁 +<b>${formatMoney(earned)} so'm</b> bonus\n\n` +
            `💰 Jami bonus: <b>${formatMoney(Math.floor(customer.points))} so'm</b>`,
            {
                parse_mode: "HTML",
                reply_markup: hasWeb ? { inline_keyboard: [[{
                    text: `🛒 ${siteName} — Yana xarid`,
                    web_app: { url: webUrl },
                }]]} : undefined,
            }
        );
    });

    console.log(`[cashbackBot] ✅ ${ctx.shop?.name || shopId}`);
}

module.exports = { attachCustomerHandlers, pinWebAppToGroup, checkCashbackBotAdmin };
