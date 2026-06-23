// src/services/dashboard.js — Dashboard API (shopId bilan filtrlangan)
// BUG FIX: dayjs timezone plugin qo'shildi, shopId ObjectId cast qilindi
const dayjs    = require("dayjs");
const utc      = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const mongoose = require("mongoose");
const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Debt     = require("../models/Debt");
const Counter  = require("../models/Counter");

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Tashkent";

// FIX: shopId ni ObjectId ga o'tkazish (aggregate da string ishlamas edi)
function toOid(id) {
    try { return new mongoose.Types.ObjectId(String(id)); }
    catch { return id; }
}

function toRange(fromStr, toStr) {
    const from = fromStr ? dayjs.tz(fromStr, TZ) : dayjs().tz(TZ).startOf("day");
    const to   = toStr   ? dayjs.tz(toStr,   TZ) : dayjs().tz(TZ).endOf("day");
    return { from: from.toDate(), to: to.toDate() };
}

async function sum(Model, match, field) {
    const r = await Model.aggregate([
        { $match: match },
        { $group: { _id: null, s: { $sum: `$${field}` } } },
    ]);
    return Number(r?.[0]?.s || 0);
}

async function getSummary(shopId, fromStr, toStr) {
    const oid = toOid(shopId);
    const { from, to } = toRange(fromStr, toStr);
    const dateMatch = { shopId: oid, createdAt: { $gte: from, $lte: to } };

    const [paidSum, debtSum, expenseSum, customerDebt, supplierDebt, balanceDoc] = await Promise.all([
        sum(Sale,    dateMatch, "paidTotal"),
        sum(Sale,    dateMatch, "debtTotal"),
        sum(Expense, dateMatch, "amount"),
        sum(Debt,    { shopId: oid, isClosed: false, kind: "customer" }, "remainingDebt"),
        sum(Debt,    { shopId: oid, isClosed: false, kind: "supplier" }, "remainingDebt"),
        Counter.findOne({ shopId, key: "balance" }),
    ]);

    return {
        cards: {
            soldTotal:    paidSum + debtSum,
            paidTotal:    paidSum,
            expenseSum,
            balance:      Number(balanceDoc?.value || 0),
            customerDebt,
            supplierDebt,
        }
    };
}

async function getActivity(shopId, fromStr, toStr, categoryKey) {
    const { from, to } = toRange(fromStr, toStr);
    const dateMatch = { shopId, createdAt: { $gte: from, $lte: to } };
    const expFilter = categoryKey && categoryKey !== "all"
        ? { ...dateMatch, categoryKey }
        : dateMatch;

    const [sales, expenses] = await Promise.all([
        Sale.find(dateMatch).sort({ createdAt: -1 }).limit(50).lean(),
        Expense.find(expFilter).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return { sales, expenses };
}

async function getChart(shopId, fromStr) {
    const oid = toOid(shopId);
    // FIX: Toshkent vaqtida kun boshliq va oxiri
    const dayStart = fromStr
        ? dayjs.tz(fromStr, TZ).startOf("day")
        : dayjs().tz(TZ).startOf("day");
    const yday = dayStart.subtract(1, "day");

    async function hourly(day) {
        const rows = await Sale.aggregate([
            {
                $match: {
                    shopId: oid,
                    createdAt: {
                        $gte: day.toDate(),
                        $lte: day.endOf("day").toDate(),
                    },
                },
            },
            { $group: { _id: { $hour: { date: "$createdAt", timezone: TZ } }, v: { $sum: "$paidTotal" } } },
            { $sort: { _id: 1 } },
        ]);
        const m = new Map(rows.map(r => [r._id, r.v]));
        return Array.from({ length: 24 }, (_, h) => ({
            hour:  String(h).padStart(2, "0"),
            value: Number(m.get(h) || 0),
        }));
    }

    const [today, yesterday] = await Promise.all([hourly(dayStart), hourly(yday)]);
    return { today, yesterday };
}

module.exports = { getSummary, getActivity, getChart };
