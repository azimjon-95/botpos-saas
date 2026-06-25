const { mongoose } = require("../db");

const SaleItemSchema = new mongoose.Schema({
    name:  { type: String, required: true },
    qty:   { type: Number, required: true, default: 1 },
    price: { type: Number, required: true },
    paid:  { type: Number, default: null }
}, { _id: false });

const SaleSchema = new mongoose.Schema({
    shopId:    { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    orderNo:   { type: String },
    seller:    { tgId: { type: Number, required: true }, tgName: { type: String, required: true } },
    phone:     { type: String, default: null },
    items:     { type: [SaleItemSchema], required: true },
    total:     { type: Number, required: true },
    paidTotal: { type: Number, required: true },
    debtTotal: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

SaleSchema.index({ shopId: 1, createdAt: -1 });
module.exports = mongoose.model("Sale", SaleSchema);
