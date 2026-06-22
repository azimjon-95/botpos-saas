// src/saas/customerHandlers.js — Mijoz boti handler'lari
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
        }

        return bot.sendMessage(chatId,
            `👋 Xush kelibsiz, ${tgName}!\n\n` +
            `🎁 Sizning bonusingiz: <b>${Math.floor(customer.points || 0).toLocaleString()}</b> so'm`,
            { parse_mode: "HTML" }
        );
    });

    console.log(`[customerHandlers] Ulandi: shopId=${shopId}`);
}

module.exports = { attachCustomerHandlers };
