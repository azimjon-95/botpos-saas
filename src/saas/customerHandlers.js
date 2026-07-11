// src/saas/customerHandlers.js — CASHBACK BOT v2
// Senior arxitektura:
//   - QR bir martalik (saleId asosida, qrUsed flag)
//   - Foiz do'kon egasi tomonidan belgilanadi (cashbackPercent)
//   - Deep link: /start?ref=shopId (bot dan to'g'ri mijozga)
//   - Customer.tgId + shopId UNIQUE index — duplikat yo'q
//   - Barcha operatsiyalar atomic (findOneAndUpdate)
"use strict";

const Customer = require("../models/Customer");
const Shop     = require("../models/Shop");
const Sale     = require("../models/Sale");
const { formatMoney } = require("../utils/money");
const crypto   = require("crypto");

// ── QR helpers ────────────────────────────────────────────────────────────────
// Format: botpos_qr_{saleId}_{hmac4}  — HMAC bilan soxtalashtirishdan himoya
const QR_PREFIX = "botpos_qr_";
const HMAC_KEY  = process.env.MASTER_ENCRYPTION_KEY || "botpos_secret_key_32ch!";

function makeQrCode(saleId) {
    const hmac = crypto
        .createHmac("sha256", HMAC_KEY)
        .update(String(saleId))
        .digest("hex")
        .slice(0, 6);
    return `${QR_PREFIX}${saleId}_${hmac}`;
}

function parseQR(text) {
    if (!text?.startsWith(QR_PREFIX)) return null;
    const body  = text.slice(QR_PREFIX.length);
    const parts = body.split("_");
    if (parts.length < 2) return null;
    const saleId = parts.slice(0, -1).join("_"); // MongoDB ObjectId (24 hex)
    const hmac   = parts[parts.length - 1];
    // HMAC tekshirish
    const expected = crypto
        .createHmac("sha256", HMAC_KEY)
        .update(saleId)
        .digest("hex")
        .slice(0, 6);
    if (hmac !== expected) return null; // Soxta QR
    return { saleId };
}

// ── Cashback hisoblash ────────────────────────────────────────────────────────
function calcCashback(amount, percent) {
    const pct = Math.max(1, Math.min(50, percent || 5));
    return Math.floor((amount * pct) / 100);
}

// ── Guruhga WebApp PIN qilish ─────────────────────────────────────────────────
async function pinWebAppToGroup(bot, shopId) {
    const shop = await Shop.findById(shopId)
        .select("name webApp webappUrl").lean();
    if (!shop?.webApp?.enabled || !shop?.webappUrl)
        throw new Error("Sayt yoqilmagan yoki URL yo'q");
    if (!shop?.webApp?.orderChatId)
        throw new Error("Guruh ID belgilanmagan");

    const chatId   = shop.webApp.orderChatId;
    const siteName = shop.webApp.siteName || shop.name;
    const url      = shop.webappUrl;

    const text = [
        `🛍 <b>${siteName}</b>`, ``,
        `✨ Mahsulotlarimizni ko'ring va buyurtma bering!`,
        `🎁 Har xariddan cashback bonus to'plang`, ``,
        `👇 Pastdagi tugmani bosing:`,
    ].join("\n");

    const msg = await bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{
            text: `🛒 ${siteName} — Xarid qilish`,
            web_app: { url },
        }]]},
    });

    if (msg?.message_id) {
        await bot.pinChatMessage(chatId, msg.message_id, {
            disable_notification: false,
        });
    }
    return { messageId: msg?.message_id, chatId };
}

// ── Cashback bot admin tekshiruvi ─────────────────────────────────────────────
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
    if (member?.can_pin_messages === false) {
        return {
            ok: false,
            error: `Cashback bot admin, lekin "Pin messages" ruxsati yo'q.`,
        };
    }
    return { ok: true, username: botInfo.username };
}

// ── Sale uchun QR yaratish (shopHandlers chaqiradi) ──────────────────────────
async function attachQrToSale(saleId) {
    const qrCode = makeQrCode(String(saleId));
    await Sale.updateOne({ _id: saleId }, { $set: { qrCode } });
    return qrCode;
}

// ── HANDLER ──────────────────────────────────────────────────────────────────
function attachCustomerHandlers(bot, ctx) {
    if (!bot || !ctx) return;
    const { shopId } = ctx;

    // ── /start (oddiy yoki deep link) ────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const tgId   = msg.from?.id;
        if (!tgId) return;

        const tgName = [msg.from?.first_name, msg.from?.last_name]
            .filter(Boolean).join(" ") || "Mijoz";

        const shop = await Shop.findById(shopId)
            .select("name webApp webappUrl cashbackPercent cashbackMinAmount billing.status")
            .lean();

        if (shop?.billing?.status === "blocked")
            return bot.sendMessage(chatId, "⛔ Do'kon hozirda faol emas.");

        // Upsert — mijoz yo'q bo'lsa yaratamiz
        const customer = await Customer.findOneAndUpdate(
            { shopId, tgId },
            { $setOnInsert: { shopId, tgId, tgName } },
            { upsert: true, new: true }
        );

        // Ismni yangilash (o'zgartirgan bo'lishi mumkin)
        if (customer.tgName !== tgName) {
            await Customer.updateOne({ _id: customer._id }, { $set: { tgName } });
        }

        if (customer.isBlocked)
            return bot.sendMessage(chatId,
                "⛔ Hisobingiz vaqtincha to'xtatilgan. Do'konga murojaat qiling.");

        const pts      = Math.floor(customer.points || 0);
        const pct      = shop?.cashbackPercent || 5;
        const minAmt   = shop?.cashbackMinAmount || 50000;
        const siteName = shop?.webApp?.siteName || shop?.name || "Do'kon";
        const webUrl   = shop?.webappUrl || "";
        const hasWeb   = !!(shop?.webApp?.enabled && webUrl);

        const text = [
            `👋 Salom, <b>${tgName}</b>!`, ``,
            `🏪 <b>${siteName}</b>`, ``,
            pts > 0
                ? `🎁 Bonusingiz: <b>${formatMoney(pts)} so'm</b>`
                : `🎁 Hali bonus yo'q — xarid qiling, ${pct}% qaytadi!`,
            ``,
            `📱 Chekdagi QR kodni skanerlang — bonus hisob to'planadi!`,
        ].join("\n");

        const inline = [];
        if (hasWeb) {
            inline.push([{
                text: `🛒 ${siteName} — Xarid qilish`,
                web_app: { url: webUrl },
            }]);
        }
        inline.push(
            [{ text: "🎁 Mening bonusim",   callback_data: "cb:balance" }],
            [{ text: "ℹ️ Qanday ishlaydi?", callback_data: "cb:howto"  }],
        );

        return bot.sendMessage(chatId, text, {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: inline },
        });
    });

    // ── Callback querylar ────────────────────────────────────────────────────
    bot.on("callback_query", async (cq) => {
        const chatId = cq.message?.chat?.id;
        const tgId   = cq.from?.id;
        const data   = cq.data || "";
        await bot.answerCallbackQuery(cq.id).catch(() => {});
        if (!chatId || !tgId) return;

        // Bonus balans
        if (data === "cb:balance") {
            const [customer, shop] = await Promise.all([
                Customer.findOne({ shopId, tgId }).lean(),
                Shop.findById(shopId).select("cashbackPercent cashbackMinAmount").lean(),
            ]);
            const pts    = Math.floor(customer?.points || 0);
            const pct    = shop?.cashbackPercent || 5;
            const minAmt = shop?.cashbackMinAmount || 50000;
            return bot.sendMessage(chatId,
                `🎁 <b>Bonus hisobingiz</b>\n\n` +
                `💰 Balans: <b>${formatMoney(pts)} so'm</b>\n` +
                `📊 Cashback: har xaridning <b>${pct}%</b>\n` +
                `📌 Minimal xarid: <b>${formatMoney(minAmt)} so'm</b>\n\n` +
                `💡 QR kodni skanerlashni unutmang!`,
                { parse_mode: "HTML" }
            );
        }

        // Qanday ishlaydi
        if (data === "cb:howto") {
            const shop = await Shop.findById(shopId)
                .select("cashbackPercent cashbackMinAmount").lean();
            const pct    = shop?.cashbackPercent || 5;
            const minAmt = shop?.cashbackMinAmount || 50000;
            return bot.sendMessage(chatId,
                `ℹ️ <b>Cashback qanday ishlaydi?</b>\n\n` +
                `1️⃣ <b>${formatMoney(minAmt)} so'm</b>dan ko'proq xarid qiling\n` +
                `2️⃣ Chekdagi QR kodni menga yuboring\n` +
                `3️⃣ Xaridingizning <b>${pct}%</b> bonusingizga qo'shiladi!\n\n` +
                `💡 Masalan: ${formatMoney(100000)} so'm xarid → ` +
                `<b>${formatMoney(Math.floor(100000*pct/100))} so'm</b> bonus\n\n` +
                `💳 Bonusingizni keyingi xaridda ishlating!`,
                { parse_mode: "HTML" }
            );
        }
    });

    // ── Xabar (QR skanerlash) ────────────────────────────────────────────────
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
                `💡 Chekdagi QR kodni menga yuboring — bonus olasiz!` +
                (hasWeb ? "\n\nYoki saytga kiring:" : ""),
                hasWeb ? { reply_markup: { inline_keyboard: [[{
                    text: "🛒 Saytga o'tish",
                    web_app: { url: webUrl },
                }]]}} : {}
            );
        }

        // ── QR validatsiya ────────────────────────────────────────────────────
        const sale = await Sale.findOne({ qrCode: text.trim() })
            .select("shopId total paidTotal qrUsed qrUsedAt qrUsedBy")
            .lean();

        // Sale topilmadi (soxta QR yoki noto'g'ri)
        if (!sale) {
            return bot.sendMessage(chatId,
                `❌ QR kod noto'g'ri yoki topilmadi.\n` +
                `Chekdagi QR ni aniq skanerlang.`
            );
        }

        // Boshqa do'kon savosi
        if (String(sale.shopId) !== String(shopId)) {
            return bot.sendMessage(chatId, "❌ Bu QR boshqa do'konga tegishli.");
        }

        // ── Bir martalik tekshiruv ─────────────────────────────────────────
        if (sale.qrUsed) {
            const usedTime = sale.qrUsedAt
                ? ` (${new Date(sale.qrUsedAt).toLocaleDateString("uz-UZ")})`
                : "";
            return bot.sendMessage(chatId,
                `⚠️ <b>Bu QR allaqachon ishlatilgan${usedTime}.</b>\n\n` +
                `Har bir chek faqat bir marta skanerlash mumkin.\n` +
                `Yangi xarid qiling va yangi QR oling!`,
                { parse_mode: "HTML" }
            );
        }

        // ── Shop sozlamalari ──────────────────────────────────────────────
        const shop = await Shop.findById(shopId)
            .select("cashbackPercent cashbackMinAmount webappUrl webApp name billing.status")
            .lean();

        if (shop?.billing?.status === "blocked")
            return bot.sendMessage(chatId, "⛔ Do'kon hozirda faol emas.");

        const pct    = shop?.cashbackPercent    || 5;
        const minAmt = shop?.cashbackMinAmount  || 50000;
        const amount = sale.paidTotal || sale.total || 0;

        // Minimal summa tekshiruvi
        if (amount < minAmt) {
            return bot.sendMessage(chatId,
                `⚠️ Cashback uchun minimal xarid: <b>${formatMoney(minAmt)} so'm</b>\n` +
                `Sizning xaridingiz: ${formatMoney(amount)} so'm\n\n` +
                `${formatMoney(minAmt)} so'mdan ko'p xarid qiling!`,
                { parse_mode: "HTML" }
            );
        }

        // ── Cashback hisoblash ─────────────────────────────────────────────
        const earned = calcCashback(amount, pct);
        if (earned <= 0)
            return bot.sendMessage(chatId, "⚠️ Bu xarid uchun cashback hisoblanmaydi.");

        // ── QR ni used deb belgilash (race condition dan himoya) ──────────
        // findOneAndUpdate bilan atomic — ikkita bir vaqtda scan bo'lsa bitta ishlaydi
        const updated = await Sale.findOneAndUpdate(
            { _id: sale._id, qrUsed: false },  // faqat used=false bo'lsa
            { $set: { qrUsed: true, qrUsedAt: new Date(), qrUsedBy: tgId } },
            { new: false }
        );

        if (!updated) {
            // Bir xil vaqtda skanerlandi — boshqa kishi ulgurdi
            return bot.sendMessage(chatId,
                `⚠️ <b>Bu QR allaqachon ishlatilgan.</b>\n` +
                `Yangi xarid qiling!`,
                { parse_mode: "HTML" }
            );
        }

        // ── Mijoz balansini atomic yangilash ──────────────────────────────
        const tgName   = [msg.from?.first_name, msg.from?.last_name]
            .filter(Boolean).join(" ") || "Mijoz";

        const customer = await Customer.findOneAndUpdate(
            { shopId, tgId },
            {
                $inc: { points: earned },
                $set: { tgName, updatedAt: new Date() },
                $setOnInsert: { shopId, tgId },
            },
            { upsert: true, new: true }
        );

        const newBalance = Math.floor(customer.points);
        const siteName   = shop?.webApp?.siteName || shop?.name || "Do'kon";
        const webUrl     = shop?.webappUrl || "";
        const hasWeb     = !!(shop?.webApp?.enabled && webUrl);

        return bot.sendMessage(chatId,
            `✅ <b>Cashback qo'shildi!</b>\n\n` +
            `🛒 Xarid: <b>${formatMoney(amount)} so'm</b>\n` +
            `📊 Cashback foizi: ${pct}%\n` +
            `🎁 +<b>${formatMoney(earned)} so'm</b> bonus\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `💰 Jami bonus: <b>${formatMoney(newBalance)} so'm</b>`,
            {
                parse_mode: "HTML",
                reply_markup: hasWeb ? { inline_keyboard: [[{
                    text: `🛒 ${siteName} — Yana xarid`,
                    web_app: { url: webUrl },
                }]]} : undefined,
            }
        );
    });

    console.log(`[cashbackBot] ✅ ${ctx.shop?.name || shopId} (cashback v2)`);
}

module.exports = {
    attachCustomerHandlers,
    pinWebAppToGroup,
    checkCashbackBotAdmin,
    attachQrToSale,
    makeQrCode,
    calcCashback,
};
