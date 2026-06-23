// src/models/Shop.js — Billing tizimi bilan kengaytirildi
const { mongoose } = require("../db");

const ShopSchema = new mongoose.Schema({
    // ─── Asosiy ─────────────────────────────────────────────────────────────
    name:                { type: String, required: true, trim: true },
    ownerName:           { type: String, required: true, trim: true },
    phone:               { type: String, required: true, trim: true },
    address:             { type: String, default: "", trim: true },
    subdomain:           { type: String, default: null, unique: true, sparse: true },

    // ─── Bot tokenlar (AES-256) ──────────────────────────────────────────────
    botToken:            { type: String, required: true },
    customerBotToken:    { type: String, default: "" },
    customerBotUsername: { type: String, default: "" },
    groupChatId:         { type: String, required: true },
    backupChatId:        { type: String, default: null },
    openaiKey:           { type: String, default: "" },
    bakerTgId:           { type: String, default: null },
    statsChatId:         { type: String, default: null },
    adminTgId:           { type: Number, default: 0 },
    minQrPaid:           { type: Number, default: 70000 },
    botPassword:         { type: String, default: "1234" },

    // ─── TARIF ──────────────────────────────────────────────────────────────
    plan: {
        type: String,
        enum: ["starter", "pro", "business"],
        default: "starter",
    },

    // ─── BILLING (yangi) ────────────────────────────────────────────────────
    billing: {
        // Oylik narx (so'mda)
        monthlyPrice:   { type: Number, default: 0 },

        // Chek printer
        hasPrinter:          { type: Boolean, default: false },
        printerType:         { type: String, enum: ["none","bought","rental"], default: "none" },
        printerMonthlyPrice: { type: Number, default: 0 },   // ijara bo'lsa

        // Keyingi to'lov sanasi
        nextPaymentDate:  { type: Date, default: null },
        lastPaymentDate:  { type: Date, default: null },

        // To'lov holati
        status: {
            type: String,
            enum: [
                "active",      // Faol — to'lov vaqtida
                "warning",     // Ogohlantirish (3 kun qoldi)
                "overdue",     // Muddati o'tgan (1+ kun kechikkan)
                "blocked",     // Bloklangan (admin blok qo'ygan)
                "grace",       // Admin ruxsat bergan (qarzga ishlaydi)
            ],
            default: "active",
            index: true,
        },

        // Admin qo'lda blok/ruxsat berishi
        adminOverride:  { type: Boolean, default: false },   // true = admin grace bergan
        overrideNote:   { type: String, default: "" },       // Sabab

        // To'lov tarixi uchun
        totalPaid:      { type: Number, default: 0 },
        debtAmount:     { type: Number, default: 0 },        // Qarzdorlik

        // Ogohlantirishlar yuborilganmi (har kun qayta yubormasliq uchun)
        lastWarningDay: { type: String, default: null },     // "2025-06-23"
    },

    // ─── Holat ──────────────────────────────────────────────────────────────
    isActive:   { type: Boolean, default: true, index: true },
    stoppedAt:  { type: Date, default: null },
    webappUrl:  { type: String, default: "" },
    notes:      { type: String, default: "" },

}, { timestamps: true, versionKey: false });

ShopSchema.index({ isActive: 1, createdAt: -1 });
ShopSchema.index({ "billing.nextPaymentDate": 1, "billing.status": 1 });

module.exports = mongoose.model("Shop", ShopSchema);
