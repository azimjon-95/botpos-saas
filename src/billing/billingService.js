// src/billing/billingService.js
"use strict";
const dayjs = require("dayjs");
const utc   = require("dayjs/plugin/utc");
const tz    = require("dayjs/plugin/timezone");
dayjs.extend(utc); dayjs.extend(tz);

const Shop    = require("../models/Shop");
const Payment = require("../models/Payment");
const TZ = "Asia/Tashkent";

// ─── TARIFLAR ─────────────────────────────────────────────────────────────────
const PLANS = {
    boshlanish: {
        key:   "boshlanish",
        emoji: "🌱",
        label: "Boshlanish",
        price: 99_000,
        features: [
            "✅ Qo'lda sotuv kiritish",
            "✅ Chiqim kiritish",
            "✅ Kassani yopish",
            "✅ Oylik hisobot",
            "✅ Qarzlar boshqaruvi",
            "✅ Xodimlar (3 tagacha)",
            "❌ Dashboard",
            "❌ AI ovoz",
            "❌ QR Cashback",
            "❌ Web App",
        ],
        // Bu planda nimalar ishlaydi
        limits: { workers: 3, aiEnabled: false, cashbackEnabled: false, webappEnabled: false, dashboardEnabled: false },
    },
    standart: {
        key:   "standart",
        emoji: "⭐",
        label: "Standart",
        price: 149_000,
        features: [
            "✅ Boshlanish barcha",
            "✅ Web Dashboard",
            "✅ Xodimlar (10 tagacha)",
            "✅ Statistika grafiklari",
            "❌ AI ovoz",
            "❌ QR Cashback",
            "❌ Web App (do'kon sayt)",
        ],
        limits: { workers: 10, aiEnabled: false, cashbackEnabled: false, webappEnabled: false, dashboardEnabled: true },
    },
    pro: {
        key:   "pro",
        emoji: "💎",
        label: "Pro",
        price: 249_000,
        features: [
            "✅ Standart barcha",
            "✅ Cheksiz xodimlar",
            "✅ Qo'shimchalar yoqish imkoni",
            "➕ AI ovoz: +50,000 so'm/oy",
            "➕ QR Cashback: +30,000 so'm/oy",
            "➕ Web App: +50,000 so'm/oy",
        ],
        limits: { workers: -1, aiEnabled: "addon", cashbackEnabled: "addon", webappEnabled: "addon", dashboardEnabled: true },
    },
    biznes: {
        key:   "biznes",
        emoji: "🏆",
        label: "Biznes",
        price: 399_000,
        features: [
            "✅ Pro barcha",
            "✅ AI ovoz — BEPUL (ichida)",
            "✅ QR Cashback — BEPUL (ichida)",
            "✅ Web App — BEPUL (ichida)",
            "✅ Priority support",
            "✅ Cheksiz hamma narsa",
        ],
        limits: { workers: -1, aiEnabled: true, cashbackEnabled: true, webappEnabled: true, dashboardEnabled: true },
    },
};

// ─── QO'SHIMCHALAR ────────────────────────────────────────────────────────────
const ADDONS = {
    ai:       { key: "ai",       emoji: "🤖", label: "AI ovoz sotuv",   price: 50_000, requiredPlan: "pro" },
    cashback: { key: "cashback", emoji: "📱", label: "QR Cashback",     price: 30_000, requiredPlan: "pro" },
    webapp:   { key: "webapp",   emoji: "🌐", label: "Web App (do'kon sayt)", price: 50_000, requiredPlan: "pro" },
};

// ─── PRINTER ─────────────────────────────────────────────────────────────────
const PRINTER = {
    none:   { oneTime: 0,       monthly: 0 },
    bought: { oneTime: 700_000, monthly: 0 },
    rental: { oneTime: 0,       monthly: 50_000 },
};

// ─── OYLIK NARX HISOBLASH ────────────────────────────────────────────────────
function calcMonthlyPrice(shop) {
    const plan    = PLANS[shop.plan] || PLANS.boshlanish;
    let   total   = plan.price;

    // Printer ijara
    if (shop.billing?.printerType === "rental") {
        total += shop.billing?.printerMonthlyPrice || PRINTER.rental.monthly;
    }

    // Qo'shimchalar — faqat Pro da (Biznes da hammasi ichida)
    if (shop.plan === "pro") {
        const addons = shop.addons || {};
        if (addons.ai)       total += ADDONS.ai.price;
        if (addons.cashback) total += ADDONS.cashback.price;
        if (addons.webapp)   total += ADDONS.webapp.price;
    }

    return total;
}

// ─── IMKONIYAT TEKSHIRUVI ─────────────────────────────────────────────────────
function canUse(shop, feature) {
    const plan   = PLANS[shop.plan] || PLANS.boshlanish;
    const limits = plan.limits;
    const addons = shop.addons || {};

    switch (feature) {
        case "ai":
            return limits.aiEnabled === true ||
                   (limits.aiEnabled === "addon" && addons.ai);
        case "cashback":
            return limits.cashbackEnabled === true ||
                   (limits.cashbackEnabled === "addon" && addons.cashback);
        case "webapp":
            return limits.webappEnabled === true ||
                   (limits.webappEnabled === "addon" && addons.webapp);
        case "dashboard":
            return !!limits.dashboardEnabled;
        case "workers":
            return limits.workers === -1 || true; // har doim xodim bo'lishi mumkin
        default:
            return false;
    }
}

// ─── ADDON YOQISH/O'CHIRISH ───────────────────────────────────────────────────
async function enableAddon(shopId, addonKey, adminEmail) {
    const addon = ADDONS[addonKey];
    if (!addon) throw new Error(`Noma'lum addon: ${addonKey}`);

    const shop = await Shop.findById(shopId).lean();
    if (!shop) throw new Error("Do'kon topilmadi");

    // Plan tekshiruvi
    if (shop.plan === "boshlanish" || shop.plan === "standart") {
        throw new Error(
            `"${PLANS[shop.plan]?.label}" tarifida "${addon.label}" mavjud emas.\n` +
            `Pro yoki Biznes tarifiga o'ting.`
        );
    }
    if (shop.plan === "biznes") {
        throw new Error(`Biznes tarifida barcha qo'shimchalar allaqachon bepul ichida!`);
    }

    // Pro — yoqish
    if (shop.addons?.[addonKey]) {
        throw new Error(`${addon.emoji} ${addon.label} allaqachon yoqilgan`);
    }

    await Shop.updateOne({ _id: shopId }, {
        [`addons.${addonKey}`]: true,
    });

    return { addon, price: addon.price, newMonthlyPrice: calcMonthlyPrice({ ...shop, addons: { ...shop.addons, [addonKey]: true } }) };
}

async function disableAddon(shopId, addonKey) {
    const addon = ADDONS[addonKey];
    if (!addon) throw new Error("Noma'lum addon");

    await Shop.updateOne({ _id: shopId }, { [`addons.${addonKey}`]: false });

    const shop = await Shop.findById(shopId).lean();
    return { addon, newMonthlyPrice: calcMonthlyPrice(shop) };
}

// ─── BILLING HOLATI ───────────────────────────────────────────────────────────
function getBillingStatus(shop) {
    const b = shop.billing;
    if (!b) return "active";
    if (b.adminOverride) return "grace";
    if (b.status === "blocked") return "blocked";
    if (!b.nextPaymentDate) return "active";

    const now      = dayjs().tz(TZ);
    const due      = dayjs(b.nextPaymentDate).tz(TZ);
    const daysLeft = due.diff(now, "day");

    if (daysLeft > 3)  return "active";
    if (daysLeft >= 0) return "warning";
    return "overdue";
}

function isShopBlocked(shop) {
    const s = getBillingStatus(shop);
    return s === "blocked" || s === "overdue";
}

// ─── TO'LOV QABUL QILISH ────────────────────────────────────────────────────
async function confirmPayment({ shopId, amount, period, description, receivedBy, isPartial }) {
    const shop = await Shop.findById(shopId);
    if (!shop) throw new Error("Do'kon topilmadi");

    const monthlyPrice = calcMonthlyPrice(shop);
    const now  = dayjs().tz(TZ);
    let nextDate = shop.billing?.nextPaymentDate && dayjs(shop.billing.nextPaymentDate).isAfter(now)
        ? dayjs(shop.billing.nextPaymentDate).add(1, "month")
        : now.add(1, "month");

    const debt = isPartial ? Math.max(0, monthlyPrice - amount) : 0;

    const payment = await Payment.create({
        shopId: shop._id, shopName: shop.name, amount,
        period: period || now.format("YYYY-MM"),
        description: description || `${now.format("MMMM YYYY")} oy to'lovi`,
        method: "manual", receivedBy,
        nextPaymentDate: nextDate.toDate(),
    });

    await Shop.updateOne({ _id: shopId }, {
        "billing.status":          "active",
        "billing.nextPaymentDate": nextDate.toDate(),
        "billing.lastPaymentDate": now.toDate(),
        "billing.totalPaid":       (shop.billing?.totalPaid || 0) + amount,
        "billing.debtAmount":      debt,
        "billing.adminOverride":   false,
        "billing.lastWarningDay":  null,
    });

    return { payment, nextPaymentDate: nextDate.toDate(), debt, monthlyPrice };
}

async function setGrace(shopId, note)    { await Shop.updateOne({ _id: shopId }, { "billing.adminOverride": true, "billing.overrideNote": note || "", "billing.status": "grace" }); }
async function removeGrace(shopId)       { await Shop.updateOne({ _id: shopId }, { "billing.adminOverride": false, "billing.overrideNote": "" }); }
async function setBlocked(shopId)        { await Shop.updateOne({ _id: shopId }, { "billing.status": "blocked", "billing.adminOverride": false }); }

async function syncAllBillingStatuses() {
    const shops = await Shop.find({ isActive: true }).lean();
    let updated = 0;
    for (const shop of shops) {
        if (shop.billing?.adminOverride || shop.billing?.status === "blocked") continue;
        const newStatus = getBillingStatus(shop);
        if (newStatus !== shop.billing?.status) {
            await Shop.updateOne({ _id: shop._id }, { "billing.status": newStatus });
            updated++;
        }
    }
    return updated;
}

async function getPaymentHistory(shopId, limit = 12) {
    return Payment.find({ shopId }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function getBillingStats() {
    const now = dayjs().tz(TZ);
    const [total, active, warning, overdue, blocked, grace] = await Promise.all([
        Shop.countDocuments({ isActive: true }),
        Shop.countDocuments({ isActive: true, "billing.status": "active" }),
        Shop.countDocuments({ isActive: true, "billing.status": "warning" }),
        Shop.countDocuments({ isActive: true, "billing.status": "overdue" }),
        Shop.countDocuments({ isActive: true, "billing.status": "blocked" }),
        Shop.countDocuments({ isActive: true, "billing.status": "grace" }),
    ]);
    const monthPaid = await Payment.aggregate([
        { $match: { createdAt: { $gte: now.startOf("month").toDate() } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    return {
        shops: { total, active, warning, overdue, blocked, grace },
        thisMonthRevenue: monthPaid?.[0]?.total || 0,
    };
}

// ─── CANUSE WEB APP (eski kod bilan mos) ─────────────────────────────────────
function canUseWebApp(plan) {
    return plan === "pro" || plan === "biznes";
}
function webAppMonthlyFee(plan) {
    if (plan === "biznes") return 0;
    if (plan === "pro")    return ADDONS.webapp.price;
    return null;
}

module.exports = {
    PLANS, ADDONS, PRINTER,
    calcMonthlyPrice,
    canUse, canUseWebApp, webAppMonthlyFee,
    enableAddon, disableAddon,
    getBillingStatus, isShopBlocked,
    confirmPayment, setGrace, removeGrace, setBlocked,
    syncAllBillingStatuses, getPaymentHistory, getBillingStats,
    // Eski nom bilan mos
    PLAN_PRICES: { boshlanish: 99_000, standart: 149_000, pro: 249_000, biznes: 399_000 },
    WEBAPP_PRICES: { pro: 50_000, biznes: 0 },
};
