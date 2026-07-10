// src/services/dailyReport.js
// [1] Har kuni 21:00 da barcha do'konlarga kunlik hisobot yuboradi
// [3] Har dushanba 10:00 da qarz eslatmasi
"use strict";

const cron    = require("node-cron");
const dayjs   = require("dayjs");
const utc     = require("dayjs/plugin/utc");
const tz      = require("dayjs/plugin/timezone");
const Shop    = require("../models/Shop");
const Sale    = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt    = require("../models/Debt");
const Counter = require("../models/Counter");

dayjs.extend(utc); dayjs.extend(tz);
const TZ = "Asia/Tashkent";

function money(n) { return Number(n || 0).toLocaleString("uz-UZ"); }

// ── Kunlik hisobot ────────────────────────────────────────────────────────────
async function sendDailyReport(bot, shop) {
    if (!shop.adminTgId) return;

    const now  = dayjs().tz(TZ);
    const from = now.startOf("day").toDate();
    const to   = now.endOf("day").toDate();
    const match = { shopId: shop._id, createdAt: { $gte: from, $lte: to } };

    const [sales, expenses, debts, balDoc] = await Promise.all([
        Sale.find(match).lean(),
        Expense.find(match).lean(),
        Debt.find({ shopId: shop._id, isClosed: false }).lean(),
        Counter.findOne({ shopId: shop._id, key: "balance" }),
    ]);

    if (!sales.length && !expenses.length) return; // Bo'sh kun — yuborma

    const saleSum    = sales.reduce((s, x) => s + (x.paidTotal || 0), 0);
    const debtSum    = sales.reduce((s, x) => s + (x.debtTotal || 0), 0);
    const expenseSum = expenses.reduce((s, x) => s + (x.amount || 0), 0);
    const openDebt   = debts.reduce((s, x) => s + (x.remainingDebt || 0), 0);
    const balance    = Number(balDoc?.value || 0);
    const foyda      = saleSum - expenseSum;

    // TOP-3 mahsulot
    const pc = {};
    for (const s of sales)
        for (const it of (s.items || []))
            pc[it.name] = (pc[it.name] || 0) + (it.qty || 1);
    const top3 = Object.entries(pc).sort((a,b)=>b[1]-a[1]).slice(0,3);

    // Xodimlar
    const ws = {};
    for (const s of sales) {
        const n = s.seller?.tgName || "—";
        if (!ws[n]) ws[n] = 0;
        ws[n] += s.paidTotal || 0;
    }

    const msg = [
        `📅 <b>Bugungi hisobot</b> — ${now.format("DD.MM.YYYY")}`,
        "",
        `💰 Tushum: <b>${money(saleSum)}</b> so'm`,
        debtSum  > 0 ? `📌 Nasiya:  <b>${money(debtSum)}</b> so'm`  : "",
        `💸 Chiqim: <b>${money(expenseSum)}</b> so'm`,
        `📉 Foyda:  <b>${foyda >= 0 ? "" : "−"}${money(Math.abs(foyda))}</b> so'm`,
        "",
        `🏦 Balans:       <b>${money(balance)}</b> so'm`,
        openDebt > 0 ? `⚠️ Ochiq qarz: <b>${money(openDebt)}</b> so'm` : "✅ Qarz yo'q",
        "",
        `📊 Sotuvlar: ${sales.length} ta | Chiqimlar: ${expenses.length} ta`,
        top3.length ? "\n🏆 Top mahsulotlar:\n" + top3.map((x,i)=>`  ${i+1}. ${x[0]} — ${x[1]} ta`).join("\n") : "",
        Object.keys(ws).length > 1
            ? "\n👷 Xodimlar:\n" + Object.entries(ws).sort((a,b)=>b[1]-a[1]).map(([n,s])=>`  ${n}: ${money(s)} so'm`).join("\n")
            : "",
    ].filter(Boolean).join("\n");

    try {
        await bot.sendMessage(shop.adminTgId, msg, { parse_mode: "HTML" });
    } catch(e) {
        console.error(`[dailyReport] ${shop.name}:`, e.message);
    }
}

// ── [3] Qarz eslatmasi (har dushanba 10:00) ───────────────────────────────────
async function sendDebtReminder(bot, shop) {
    if (!shop.adminTgId) return;

    const debts = await Debt.find({
        shopId: shop._id, isClosed: false, kind: "customer",
    }).sort({ remainingDebt: -1 }).limit(10).lean();

    if (!debts.length) return;

    const total = debts.reduce((s, d) => s + d.remainingDebt, 0);

    const lines = debts.slice(0, 5).map((d, i) =>
        `  ${i+1}. ${d.customerName || d.customerPhone || "Noma'lum"}: <b>${money(d.remainingDebt)}</b> so'm`
    );

    const msg = [
        `📌 <b>Qarz eslatmasi</b>`,
        "",
        `${debts.length} ta mijoz jami <b>${money(total)}</b> so'm qarzdor:`,
        "",
        ...lines,
        debts.length > 5 ? `  ... va yana ${debts.length - 5} ta` : "",
        "",
        `💡 Qarzlarni ko'rish: "📌 Qarzlar" tugmasini bosing`,
    ].filter(Boolean).join("\n");

    try {
        await bot.sendMessage(shop.adminTgId, msg, { parse_mode: "HTML" });
    } catch(e) {
        console.error(`[debtReminder] ${shop.name}:`, e.message);
    }
}

// ── Schedulerlarni ishga tushirish ────────────────────────────────────────────
function startDailyReportScheduler(getBotForShop) {
    // [1] Har kuni 21:00 — kunlik hisobot
    cron.schedule("0 21 * * *", async () => {
        console.log("[dailyReport] 21:00 — kunlik hisobotlar yuborilmoqda...");
        try {
            const shops = await Shop.find({
                isActive: true,
                "billing.status": { $ne: "blocked" },
                adminTgId: { $exists: true, $ne: null },
            }).lean();

            let sent = 0;
            for (const shop of shops) {
                const bot = getBotForShop(shop._id);
                if (!bot) continue;
                await sendDailyReport(bot, shop);
                sent++;
                await new Promise(r => setTimeout(r, 100)); // spam limitdan saqlanish
            }
            console.log(`[dailyReport] ${sent}/${shops.length} ta do'konga yuborildi`);
        } catch(e) {
            console.error("[dailyReport] xato:", e.message);
        }
    }, { timezone: TZ });

    // [3] Har dushanba 10:00 — qarz eslatmasi
    cron.schedule("0 10 * * 1", async () => {
        console.log("[debtReminder] Dushanba 10:00 — qarz eslatmalari...");
        try {
            const shops = await Shop.find({
                isActive: true,
                adminTgId: { $exists: true, $ne: null },
            }).lean();

            for (const shop of shops) {
                const bot = getBotForShop(shop._id);
                if (!bot) continue;
                await sendDebtReminder(bot, shop);
                await new Promise(r => setTimeout(r, 150));
            }
        } catch(e) {
            console.error("[debtReminder] xato:", e.message);
        }
    }, { timezone: TZ });

    console.log("✅ Kunlik hisobot: 21:00 | Qarz eslatma: Dushanba 10:00");
}

module.exports = { startDailyReportScheduler, sendDailyReport, sendDebtReminder };
