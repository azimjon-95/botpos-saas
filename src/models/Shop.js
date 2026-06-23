// src/models/Shop.js
// CHANGE: openaiKey olib tashlandi (markaziy OpenAI)
// NEW: status field (pending|active|blocked), onboarding ma'lumotlari
"use strict";
const { mongoose } = require("../db");

const ShopSchema = new mongoose.Schema({
    // ─── Asosiy ─────────────────────────────────────────────────────────────
    name:       { type: String, required: true, trim: true },
    ownerName:  { type: String, required: true, trim: true },
    phone:      { type: String, required: true, trim: true },
    address:    { type: String, default: "", trim: true },
    subdomain:  { type: String, default: null, unique: true, sparse: true },

    // ─── Do'kon holati ───────────────────────────────────────────────────────
    // pending  = token hali berilmagan (onboarding bosqichida)
    // active   = to'liq ishga tushgan
    // blocked  = to'lov muammosi yoki admin blok
    // disabled = admin o'chirib qo'ygan
    status: {
        type: String,
        enum: ["pending", "active", "blocked", "disabled"],
        default: "pending",
        index: true,
    },
    isActive:   { type: Boolean, default: false, index: true }, // status=active bo'lganda true

    // ─── Bot tokenlar (AES-256) — IXTIYORIY (pending da yo'q bo'lishi mumkin)
    botToken:            { type: String, default: "" },
    customerBotToken:    { type: String, default: "" },
    customerBotUsername: { type: String, default: "" },
    groupChatId:         { type: String, default: "" },
    backupChatId:        { type: String, default: null },

    // ─── Do'kon sozlamalari ──────────────────────────────────────────────────
    bakerTgId:   { type: String, default: null },
    statsChatId: { type: String, default: null },
    adminTgId:   { type: Number, default: 0 },
    minQrPaid:   { type: Number, default: 70000 },
    botPassword:  { type: String, default: "1234" },

    // ─── TARIF ──────────────────────────────────────────────────────────────
    plan: {
        type: String,
        enum: ["starter", "pro", "business"],
        default: "starter",
    },

    // ─── BILLING ────────────────────────────────────────────────────────────
    billing: {
        monthlyPrice:        { type: Number, default: 0 },
        hasPrinter:          { type: Boolean, default: false },
        printerType:         { type: String, enum: ["none","bought","rental"], default: "none" },
        printerMonthlyPrice: { type: Number, default: 0 },
        nextPaymentDate:     { type: Date, default: null },
        lastPaymentDate:     { type: Date, default: null },
        status: {
            type: String,
            enum: ["active","warning","overdue","blocked","grace"],
            default: "active",
        },
        adminOverride:   { type: Boolean, default: false },
        overrideNote:    { type: String, default: "" },
        totalPaid:       { type: Number, default: 0 },
        debtAmount:      { type: Number, default: 0 },
        lastWarningDay:  { type: String, default: null },
    },

    // ─── OpenAI TOKEN SARFI (markaziy, do'kon bo'yicha hisob) ────────────────
    aiUsage: {
        totalTokens:   { type: Number, default: 0 },  // Jami token sarfи
        totalRequests: { type: Number, default: 0 },  // Jami so'rovlar
        thisMonthTokens:   { type: Number, default: 0 },
        thisMonthRequests: { type: Number, default: 0 },
        lastResetMonth:    { type: String, default: "" },  // "2025-06"
        estimatedCostUSD:  { type: Number, default: 0 },   // Taxminiy xarajat
    },

    // ─── Onboarding (ro'yxatdan o'tish so'rovi) ──────────────────────────────
    onboarding: {
        submittedAt:  { type: Date, default: null },   // Forma yuborilgan vaqt
        approvedAt:   { type: Date, default: null },   // Admin tasdiqlaganda
        approvedBy:   { type: String, default: "" },   // Admin email
        selectedPlan: { type: String, default: "" },   // Kalkulyatorda tanlagan
        hasPrinter:   { type: Boolean, default: false },
        printerType:  { type: String, default: "none" },
        notes:        { type: String, default: "" },   // Mijoz izohi
        calculatedPrice: { type: Number, default: 0 }, // Kalkulyator natijasi
    },

    webappUrl: { type: String, default: "" },
    notes:     { type: String, default: "" },
    stoppedAt: { type: Date, default: null },

}, { timestamps: true, versionKey: false });

ShopSchema.index({ status: 1, createdAt: -1 });
ShopSchema.index({ isActive: 1, createdAt: -1 });
ShopSchema.index({ "billing.nextPaymentDate": 1, "billing.status": 1 });

module.exports = mongoose.model("Shop", ShopSchema);
