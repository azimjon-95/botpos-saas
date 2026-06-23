// src/billing/billingService.js — Billing logikasi
"use strict";
const dayjs = require("dayjs");
const utc   = require("dayjs/plugin/utc");
const tz    = require("dayjs/plugin/timezone");
dayjs.extend(utc); dayjs.extend(tz);

const Shop    = require("../models/Shop");
const Payment = require("../models/Payment");

const TZ = "Asia/Tashkent";

// ─── TARIF NARXLARI ──────────────────────────────────────────────────────────
const PLAN_PRICES = {
    starter:  150_000,
    pro:      300_000,
    business: 500_000,
};

// ─── TO'LIQ OY NARXINI HISOBLASH ─────────────────────────────────────────────
function calcMonthlyPrice(shop) {
    const base    = PLAN_PRICES[shop.plan] || PLAN_PRICES.starter;
    const printer = shop.billing?.printerType === "rental"
        ? (shop.billing?.printerMonthlyPrice || 0)
        : 0;
    return base + printer;
}

// ─── BILLING HOLATI ───────────────────────────────────────────────────────────
// active   = to'lov muddati kelganga 4+ kun bor
// warning  = 3 kun yoki kamroq qoldi
// overdue  = muddati o'tdi (lekin grace emas)
// grace    = admin ruxsat bergan, qarzga ishlaydi
// blocked  = to'liq bloklangan
function getBillingStatus(shop) {
    const b = shop.billing;
    if (!b) return "active";

    // Admin override — har doim grace
    if (b.adminOverride) return "grace";

    // Admin qo'lda blok
    if (b.status === "blocked") return "blocked";

    if (!b.nextPaymentDate) return "active";

    const now     = dayjs().tz(TZ);
    const due     = dayjs(b.nextPaymentDate).tz(TZ);
    const daysLeft = due.diff(now, "day");

    if (daysLeft > 3)  return "active";
    if (daysLeft >= 0) return "warning";
    return "overdue";
}

// ─── BLOK TEKSHIRUV (bot va webapp uchun) ────────────────────────────────────
function isShopBlocked(shop) {
    const status = getBillingStatus(shop);
    return status === "blocked" || status === "overdue";
}

// ─── TO'LOV QABUL QILISH (admin qo'lda) ─────────────────────────────────────
async function confirmPayment({ shopId, amount, period, description, receivedBy, isPartial }) {
    const shop = await Shop.findById(shopId);
    if (!shop) throw new Error("Do'kon topilmadi");

    const monthlyPrice = calcMonthlyPrice(shop);
    const now = dayjs().tz(TZ);

    // Keyingi to'lov sanasini hisoblash
    let nextDate;
    if (shop.billing?.nextPaymentDate && dayjs(shop.billing.nextPaymentDate).isAfter(now)) {
        // Muddati o'tib ketmagan — shu sanadan 1 oy qo'shamiz
        nextDate = dayjs(shop.billing.nextPaymentDate).add(1, "month");
    } else {
        // Muddati o'tgan yoki birinchi to'lov — bugundan 1 oy
        nextDate = now.add(1, "month");
    }

    // Qarzni yangilash
    let debt = shop.billing?.debtAmount || 0;
    if (isPartial) {
        // Qisman to'lov
        debt = Math.max(0, monthlyPrice - amount);
    } else {
        debt = 0;
    }

    // To'lovni saqlash
    const payment = await Payment.create({
        shopId: shop._id,
        shopName: shop.name,
        amount,
        period: period || now.format("YYYY-MM"),
        description: description || `${now.format("MMMM YYYY")} oy to'lovi`,
        method: "manual",
        receivedBy,
        nextPaymentDate: nextDate.toDate(),
    });

    // Shop billing ni yangilash
    await Shop.updateOne({ _id: shopId }, {
        "billing.status":          "active",
        "billing.nextPaymentDate": nextDate.toDate(),
        "billing.lastPaymentDate": now.toDate(),
        "billing.totalPaid":       (shop.billing?.totalPaid || 0) + amount,
        "billing.debtAmount":      debt,
        "billing.adminOverride":   false,
        "billing.lastWarningDay":  null,
    });

    return { payment, nextPaymentDate: nextDate.toDate(), debt };
}

// ─── ADMIN OVERRIDE — GRACE BERISH ───────────────────────────────────────────
async function setGrace(shopId, note, adminEmail) {
    await Shop.updateOne({ _id: shopId }, {
        "billing.adminOverride": true,
        "billing.overrideNote":  note || "",
        "billing.status":        "grace",
    });
}

async function removeGrace(shopId) {
    await Shop.updateOne({ _id: shopId }, {
        "billing.adminOverride": false,
        "billing.overrideNote":  "",
    });
}

// ─── ADMIN BLOK ───────────────────────────────────────────────────────────────
async function setBlocked(shopId) {
    await Shop.updateOne({ _id: shopId }, {
        "billing.status":        "blocked",
        "billing.adminOverride": false,
    });
}

// ─── BARCHA SHOPLAR STATUS YANGILASH (scheduler chaqiradi) ───────────────────
async function syncAllBillingStatuses() {
    const shops = await Shop.find({ isActive: true }).lean();
    let updated = 0;
    for (const shop of shops) {
        if (shop.billing?.adminOverride) continue; // grace — tegmaymiz
        if (shop.billing?.status === "blocked")    continue;

        const newStatus = getBillingStatus(shop);
        if (newStatus !== shop.billing?.status) {
            await Shop.updateOne({ _id: shop._id }, { "billing.status": newStatus });
            updated++;
        }
    }
    return updated;
}

// ─── TO'LOV TARIXI ────────────────────────────────────────────────────────────
async function getPaymentHistory(shopId, limit = 12) {
    return Payment.find({ shopId }).sort({ createdAt: -1 }).limit(limit).lean();
}

// ─── STATISTIKA ───────────────────────────────────────────────────────────────
async function getBillingStats() {
    const now = dayjs().tz(TZ);
    const [
        totalShops, activeShops, warningShops,
        overdueShops, blockedShops, graceShops,
    ] = await Promise.all([
        Shop.countDocuments({ isActive: true }),
        Shop.countDocuments({ isActive: true, "billing.status": "active" }),
        Shop.countDocuments({ isActive: true, "billing.status": "warning" }),
        Shop.countDocuments({ isActive: true, "billing.status": "overdue" }),
        Shop.countDocuments({ isActive: true, "billing.status": "blocked" }),
        Shop.countDocuments({ isActive: true, "billing.status": "grace" }),
    ]);

    // Bu oy jami tushgan pul
    const monthStart = now.startOf("month").toDate();
    const monthPaid  = await Payment.aggregate([
        { $match: { createdAt: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return {
        shops: { total: totalShops, active: activeShops, warning: warningShops,
                 overdue: overdueShops, blocked: blockedShops, grace: graceShops },
        thisMonthRevenue: monthPaid?.[0]?.total || 0,
    };
}

module.exports = {
    PLAN_PRICES,
    calcMonthlyPrice,
    getBillingStatus,
    isShopBlocked,
    confirmPayment,
    setGrace,
    removeGrace,
    setBlocked,
    syncAllBillingStatuses,
    getPaymentHistory,
    getBillingStats,
};
