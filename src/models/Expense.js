const { mongoose } = require("../db");

const PersonSchema = new mongoose.Schema({
    tgId: { type: Number, required: true },
    tgName: { type: String, required: true }
}, { _id: false });

const ExpenseSchema = new mongoose.Schema({
    shopId:      { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    orderNo:     { type: String, required: true },
    spender:     { type: PersonSchema, required: true },
    title:       { type: String, required: true },
    amount:      { type: Number, required: true },
    categoryKey: { type: String, default: "other" },
    supplierId:  { type: mongoose.Schema.Types.ObjectId, default: null },
    description: { type: String, default: "" }
}, { timestamps: true });

ExpenseSchema.index({ shopId: 1, createdAt: 1 });
module.exports = mongoose.model("Expense", ExpenseSchema);
