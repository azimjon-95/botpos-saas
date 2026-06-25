// src/models/Payment.js — To'lovlar tarixi
const { mongoose } = require("../db");

const PaymentSchema = new mongoose.Schema({
    shopId:      { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    shopName:    { type: String, default: "" },

    // To'lov ma'lumotlari
    amount:      { type: Number, required: true },          // So'mda
    period:      { type: String, required: true },          // "2025-06" (yil-oy)
    description: { type: String, default: "" },             // Izoh
    method:      { type: String, default: "manual" },       // manual | click | payme

    // Kim qabul qildi
    receivedBy:  { type: String, default: "" },             // Admin email
    confirmedAt: { type: Date, default: Date.now },

    // Keyingi to'lov sanasi (hisoblangan)
    nextPaymentDate: { type: Date, default: null },

}, { timestamps: true, versionKey: false });

PaymentSchema.index({ shopId: 1, createdAt: -1 });
PaymentSchema.index({ period: 1 });

module.exports = mongoose.model("Payment", PaymentSchema);
