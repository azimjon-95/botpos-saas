const { mongoose } = require("../db");
const Sale    = require("../models/Sale");
const Debt    = require("../models/Debt");
const Counter = require("../models/Counter");

async function nextOrderNo(shopId, session) {
    const doc = await Counter.findOneAndUpdate(
        { shopId, key: "orderNo" },
        { $inc: { value: 1 } },
        { new: true, upsert: true, session }
    );
    return `#${String(doc.value).padStart(4, "0")}`;
}

async function saveSale({ shopId, seller, items, phone }) {
    const session = await mongoose.startSession();
    let result;
    try {
        session.startTransaction();
        let total = 0, paidTotal = 0;
        for (const it of items) {
            const line = (it.qty || 1) * (it.price || 0);
            total += line;
            paidTotal += (it.paid ?? line);
        }
        paidTotal = Math.min(paidTotal, total);
        const debtTotal = Math.max(0, total - paidTotal);
        const orderNo = await nextOrderNo(shopId, session);
        const [sale] = await Sale.create([{ shopId, orderNo, seller, phone: phone || null, items, total, paidTotal, debtTotal }], { session });
        await Counter.findOneAndUpdate({ shopId, key: "balance" }, { $inc: { value: paidTotal } }, { new: true, upsert: true, session });
        if (debtTotal > 0) {
            await Debt.create([{ shopId, saleId: sale._id, customerPhone: phone || null, totalDebt: debtTotal, remainingDebt: debtTotal, seller }], { session });
        }
        await session.commitTransaction();
        result = { paidTotal, debtTotal, orderNo, total };
    } catch (e) {
        await session.abortTransaction();
        throw e;
    } finally {
        session.endSession();
    }
    return result;
}
module.exports = { saveSale };
