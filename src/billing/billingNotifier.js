// src/billing/billingNotifier.js — To'lov eslatmalari scheduleri
// Har kuni 10:00 da ishlaydi
// 3 kun oldindan har kuni ogohlantiradi
// 1 kun o'tgach bloklaydi
"use strict";
const schedule = require("node-schedule");
const dayjs    = require("dayjs");
const utc      = require("dayjs/plugin/utc");
const tz       = require("dayjs/plugin/timezone");
dayjs.extend(utc); dayjs.extend(tz);

const Shop    = require("../models/Shop");
const { getBot }             = require("../saas/botManager");
const { syncAllBillingStatuses, calcMonthlyPrice } = require("./billingService");

const TZ = "Asia/Tashkent";

// ─── XABAR FORMATLARI ────────────────────────────────────────────────────────

function warningMsg(shop, daysLeft, price) {
    const due = dayjs(shop.billing.nextPaymentDate).tz(TZ).format("DD.MM.YYYY");
    return [
        `⚠️ <b>To'lov eslatmasi</b>`,
        ``,
        `Do'kon: <b>${shop.name}</b>`,
        `Tarif: <b>${shop.plan.toUpperCase()}</b>${shop.billing.hasPrinter ? " + Printer" : ""}`,
        ``,
        `💰 To'lov summasi: <b>${price.toLocaleString()} so'm/oy</b>`,
        shop.webApp?.enabled && shop.plan === "pro"
            ? `   └ Web App: <b>+50,000 so'm</b> (Pro qo'shimcha)`
            : "",
        `📅 To'lov sanasi: <b>${due}</b>`,
        `⏳ Qolgan vaqt: <b>${daysLeft} kun</b>`,
        ``,
        `❗ To'lov amalga oshirilmasa, tizim <b>${daysLeft === 0 ? "BUGUN" : daysLeft + " kundan keyin"}</b> bloklangadi.`,
        ``,
        `📞 To'lov uchun: @botpos_support`,
    ].join("\n");
}

function blockedMsg(shop, price) {
    return [
        `🚫 <b>TIZIM BLOKLANGAN!</b>`,
        ``,
        `Do'kon: <b>${shop.name}</b>`,
        `💰 Qarzdorlik: <b>${price.toLocaleString()} so'm</b>`,
        ``,
        `❌ Sotuv va WebApp ishlamaydi.`,
        ``,
        `✅ To'lovni amalga oshiring va adminга xabar yuboring:`,
        `📞 @botpos_support`,
    ].join("\n");
}

function adminWarningMsg(shop, daysLeft, price) {
    const due = dayjs(shop.billing.nextPaymentDate).tz(TZ).format("DD.MM.YYYY");
    return [
        `⚠️ <b>To'lov eslatmasi [Admin]</b>`,
        ``,
        `🏪 Do'kon: <b>${shop.name}</b>`,
        `👤 Egasi: ${shop.ownerName} (${shop.phone})`,
        `📦 Tarif: ${shop.plan} | 💰 ${price.toLocaleString()} so'm`,
        `📅 Muddat: <b>${due}</b> (${daysLeft} kun qoldi)`,
        daysLeft <= 0 ? `🚫 <b>BLOKLANDI!</b>` : "",
    ].filter(Boolean).join("\n");
}

// ─── ASOSIY TEKSHIRUV ─────────────────────────────────────────────────────────
async function runBillingCheck() {
    const now     = dayjs().tz(TZ);
    const today   = now.format("YYYY-MM-DD");

    // Statuslarni yangilash
    await syncAllBillingStatuses();

    // Ogohlantirishga kerak bo'lgan do'konlar:
    // nextPaymentDate 3 kun ichida yoki o'tib ketgan, grace emas
    const shops = await Shop.find({
        isActive: true,
        "billing.adminOverride": { $ne: true },
        "billing.status":        { $ne: "blocked" },
        "billing.nextPaymentDate": { $lte: now.add(3, "day").toDate() },
    }).lean();

    const adminBotToken = process.env.ADMIN_NOTIFICATION_BOT_TOKEN;
    const adminChatId   = process.env.ADMIN_NOTIFICATION_CHAT_ID;

    for (const shop of shops) {
        if (!shop.billing?.nextPaymentDate) continue;

        const due      = dayjs(shop.billing.nextPaymentDate).tz(TZ);
        const daysLeft = due.diff(now, "day");
        const price    = calcMonthlyPrice(shop);

        // Bugun allaqachon ogohlantirildimi?
        if (shop.billing.lastWarningDay === today) continue;

        const bot = getBot(shop._id);

        // 1. Do'kon botiga (foydalanuvchiga) — guruhga xabar
        if (shop.groupChatId && bot) {
            const msg = daysLeft < 0
                ? blockedMsg(shop, price)
                : warningMsg(shop, daysLeft, price);

            await bot.sendMessage(shop.groupChatId, msg, { parse_mode: "HTML" })
                .catch(e => console.error(`[billing] guruh xabar xato ${shop.name}:`, e.message));

            // Do'kon adminiga ham shaxsiy xabar
            if (shop.adminTgId) {
                await bot.sendMessage(shop.adminTgId, msg, { parse_mode: "HTML" })
                    .catch(() => {});
            }
        }

        // 2. Super admin ga xabar (alohida bot yoki birinchi faol bot orqali)
        if (adminChatId) {
            try {
                const TelegramBot = require("node-telegram-bot-api");
                const adminBot = adminBotToken
                    ? new TelegramBot(adminBotToken, { polling: false })
                    : null;
                if (adminBot) {
                    await adminBot.sendMessage(adminChatId, adminWarningMsg(shop, daysLeft, price), {
                        parse_mode: "HTML",
                    });
                }
            } catch {}
        }

        // Bugun yuborildi deb belgilash
        await Shop.updateOne({ _id: shop._id }, { "billing.lastWarningDay": today });

        // 1 kun o'tgan bo'lsa bloklash
        if (daysLeft < -1 && !shop.billing.adminOverride) {
            await Shop.updateOne({ _id: shop._id }, { "billing.status": "blocked" });

            const { stopShopBot } = require("../saas/botManager");
            // Bot ni to'xtatmaymiz — faqat xabar yuboramiz
            // (botni to'xtatish ko'p resurs ketkazadi)
            console.log(`[billing] 🚫 BLOKLANDI: ${shop.name}`);
        }
    }

    console.log(`[billing] ✅ Tekshiruv tugadi. ${shops.length} ta do'kon tekshirildi.`);
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────
function startBillingScheduler() {
    // Har kuni soat 10:00 da (Toshkent vaqti)
    schedule.scheduleJob({ hour: 10, minute: 0, tz: TZ }, async () => {
        console.log("[billing] ⏰ Billing tekshiruvi boshlanadi...");
        try {
            await runBillingCheck();
        } catch (e) {
            console.error("[billing] ❌ Xato:", e.message);
        }
    });

    console.log("✅ Billing scheduler ishga tushdi (har kuni 10:00 Toshkent)");
}

module.exports = { startBillingScheduler, runBillingCheck };
