// src/services/dashboard.js — Dashboard API (shopId bilan filtrlangan)
const dayjs = require("dayjs");
const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Debt     = require("../models/Debt");
const Supplier = require("../models/Supplier");
const Counter  = require("../models/Counter");

function toRange(fromStr, toStr) {
    const from = fromStr ? dayjs(fromStr) : dayjs().startOf("day");
    const to   = toStr   ? dayjs(toStr)   : dayjs().endOf("day");
    return { from: from.toDate(), to: to.toDate() };
}

async function sum(Model, match, field) {
    const r = await Model.aggregate([
        { $match: match },
        { $group: { _id: null, s: { $sum: `$${field}` } } }
    ]);
    return Number(r?.[0]?.s || 0);
}

async function getSummary(shopId, fromStr, toStr) {
    const { from, to } = toRange(fromStr, toStr);
    const dateMatch = { shopId, createdAt: { $gte: from, $lte: to } };

    const [paidSum, debtSum, expenseSum, customerDebt, supplierDebt, balanceDoc] = await Promise.all([
        sum(Sale,    dateMatch, "paidTotal"),
        sum(Sale,    dateMatch, "debtTotal"),
        sum(Expense, dateMatch, "amount"),
        sum(Debt,    { shopId, isClosed: false, kind: "customer" }, "remainingDebt"),
        sum(Debt,    { shopId, isClosed: false, kind: "supplier" }, "remainingDebt"),
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
    const dayStart = fromStr ? dayjs(fromStr).startOf("day") : dayjs().startOf("day");
    const dayEnd   = dayStart.endOf("day");
    const yday     = dayStart.subtract(1, "day");

    async function hourly(day) {
        const rows = await Sale.aggregate([
            { $match: { shopId, createdAt: { $gte: day.toDate(), $lte: day.endOf("day").toDate() } } },
            { $group: { _id: { h: { $hour: "$createdAt" } }, v: { $sum: "$paidTotal" } } },
            { $sort: { "_id.h": 1 } }
        ]);
        const m = new Map(rows.map(r => [r._id.h, r.v]));
        return Array.from({ length: 24 }, (_, h) => ({
            hour: `${String(h).padStart(2, "0")}`, value: Number(m.get(h) || 0)
        }));
    }

    const [today, yesterday] = await Promise.all([hourly(dayStart), hourly(yday)]);
    return { today, yesterday };
}

module.exports = { getSummary, getActivity, getChart };
