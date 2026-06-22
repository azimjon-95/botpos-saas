const Sale    = require("../models/Sale");
const Expense = require("../models/Expense");
const Debt    = require("../models/Debt");
const Counter = require("../models/Counter");
const { startOfToday, endOfToday } = require("../utils/time");

async function closeCash(shopId) {
    const from = startOfToday();
    const to   = endOfToday();
    const [sales, expenses, debts, balanceDoc] = await Promise.all([
        Sale.find({ shopId, createdAt: { $gte: from, $lte: to } }).lean(),
        Expense.find({ shopId, createdAt: { $gte: from, $lte: to } }).lean(),
        Debt.find({ shopId, isClosed: false }).lean(),
        Counter.findOne({ shopId, key: "balance" }),
    ]);
    return {
        saleSum:    sales.reduce((a, s) => a + (s.paidTotal || 0), 0),
        expenseSum: expenses.reduce((a, e) => a + (e.amount || 0), 0),
        debtSum:    debts.reduce((a, d) => a + (d.remainingDebt || 0), 0),
        balance:    Number(balanceDoc?.value || 0),
        salesCount: sales.length,
    };
}
module.exports = { closeCash };
