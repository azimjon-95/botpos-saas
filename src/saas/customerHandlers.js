// src/saas/customerHandlers.js — Mijoz cashback boti
// FIX: isBlocked tekshiruvi qo'shildi
const Customer = require("../models/Customer");

function attachCustomerHandlers(bot, ctx) {
    if (!bot || !ctx) return;
    const { shopId } = ctx;

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const tgId   = msg.from?.id;
        const tgName = msg.from?.first_name || "Mijoz";
        if (!tgId) return;

        let customer = await Customer.findOne({ shopId, tgId });
        if (!customer) {
            customer = await Customer.create({ shopId, tgId, tgName });
        } else if (customer.tgName !== tgName) {
            customer.tgName = tgName;
            await customer.save();
        }

        // FIX: Bloklangan mijozga xabar
        if (customer.isBlocked) {
            return bot.sendMessage(chatId,
                "⛔ Afsuski, sizning hisobingiz vaqtincha to'xtatilgan.\nMa'lumot uchun do'konga murojaat qiling."
            );
        }

        const bonus = Math.floor(customer.points || 0);
        return bot.sendMessage(chatId,
            `👋 Xush kelibsiz, <b>${tgName}</b>!\n\n` +
            `🎁 Sizning bonusingiz: <b>${bonus.toLocaleString()}</b> so'm\n\n` +
            `💡 Har xariddan ball to'playsiz!`,
            { parse_mode: "HTML" }
        );
    });

    console.log(`[customerHandlers] ✅ Ulandi: ${ctx.shop?.name || shopId}`);
}

module.exports = { attachCustomerHandlers };
