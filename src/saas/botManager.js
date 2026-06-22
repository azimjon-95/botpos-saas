// src/saas/botManager.js — TZ 3.3 bo'yicha dinamik bot boshqaruvi
const TelegramBot = require("node-telegram-bot-api");
const Shop = require("../models/Shop");
const { decrypt } = require("../utils/encrypt");

const _bots = new Map(); // shopId → { bot, customerBot, shop }

function createPollingBot(token, name) {
    const bot = new TelegramBot(token, {
        polling: {
            interval: 500,
            autoStart: true,
            params: { timeout: 30, allowed_updates: ["message", "callback_query"] },
        },
    });
    bot.deleteWebHook({ drop_pending_updates: true }).catch(() => {});
    bot.on("polling_error", (err) => {
        const msg = err?.message || String(err);
        if (!msg.includes("ETIMEDOUT") && !msg.includes("EAI_AGAIN")) {
            console.error(`[${name}] polling_error:`, msg.slice(0, 120));
        }
    });
    return bot;
}

async function startShopBot(shop) {
    const shopId = String(shop._id);
    if (_bots.has(shopId)) await stopShopBot(shopId);

    let botToken, customerBotToken;
    try {
        botToken         = decrypt(shop.botToken);
        customerBotToken = shop.customerBotToken ? decrypt(shop.customerBotToken) : null;
    } catch (e) {
        console.error(`[botManager] ${shop.name}: token decrypt xato:`, e.message);
        return null;
    }

    if (!botToken) {
        console.warn(`[botManager] ${shop.name}: botToken bo'sh — skip`);
        return null;
    }

    const ctx = {
        shopId:      shop._id,
        shop,
        groupChatId: shop.groupChatId,
        webappUrl:   shop.webappUrl || "",
        adminTgId:   shop.adminTgId,
        botPassword: shop.botPassword,
        minQrPaid:   shop.minQrPaid,
    };

    let bot = null;
    let customerBot = null;

    try {
        bot = createPollingBot(botToken, `BOT:${shop.name}`);
        bot._shopContext = ctx;
        const { attachHandlers } = require("./shopHandlers");
        attachHandlers(bot, ctx);
        console.log(`✅ Bot: ${shop.name}`);
    } catch (e) {
        console.error(`[botManager] ${shop.name} bot xato:`, e.message);
    }

    if (customerBotToken) {
        try {
            customerBot = createPollingBot(customerBotToken, `CBOT:${shop.name}`);
            customerBot._shopContext = ctx;
            const { attachCustomerHandlers } = require("./customerHandlers");
            attachCustomerHandlers(customerBot, ctx);
            console.log(`✅ CustomerBot: ${shop.name}`);
        } catch (e) {
            console.error(`[botManager] ${shop.name} customerBot xato:`, e.message);
        }
    }

    _bots.set(shopId, { bot, customerBot, shop });
    return bot;
}

async function stopShopBot(shopId) {
    const entry = _bots.get(String(shopId));
    if (!entry) return;
    try { if (entry.bot) await entry.bot.stopPolling(); } catch {}
    try { if (entry.customerBot) await entry.customerBot.stopPolling(); } catch {}
    _bots.delete(String(shopId));
    console.log(`🛑 Bot to'xtatildi: shopId=${shopId}`);
}

async function loadAllShops() {
    const shops = await Shop.find({ isActive: true }).lean();
    console.log(`[botManager] ${shops.length} ta faol do'kon`);
    const results = await Promise.allSettled(shops.map(s => startShopBot(s)));
    const ok  = results.filter(r => r.status === "fulfilled" && r.value).length;
    console.log(`[botManager] ${ok}/${shops.length} bot ishga tushdi`);
}

function getBot(shopId) {
    return _bots.get(String(shopId))?.bot || null;
}

async function reloadShop(shopId) {
    const shop = await Shop.findById(shopId).lean();
    if (!shop || !shop.isActive) { await stopShopBot(shopId); return null; }
    return startShopBot(shop);
}

function getStatus() {
    const list = [];
    for (const [shopId, entry] of _bots.entries()) {
        list.push({
            shopId,
            shopName:          entry.shop?.name,
            botActive:         !!entry.bot,
            customerBotActive: !!entry.customerBot,
        });
    }
    return list;
}

module.exports = { loadAllShops, startShopBot, stopShopBot, getBot, reloadShop, getStatus };
