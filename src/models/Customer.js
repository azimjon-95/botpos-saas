// src/models/Customer.js
// FIX: isBlocked maydoni qo'shildi
const { mongoose } = require("../db");

const CustomerSchema = new mongoose.Schema({
    shopId:    { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    tgId:      { type: Number, required: true, index: true },
    tgName:    { type: String, default: "" },
    points:    { type: Number, default: 0 },
    refCount:  { type: Number, default: 0 },
    refPoints: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false, index: true },
    updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

CustomerSchema.index({ shopId: 1, tgId: 1 }, { unique: true });
CustomerSchema.index({ shopId: 1, isBlocked: 1 });

module.exports = mongoose.model("Customer", CustomerSchema);
