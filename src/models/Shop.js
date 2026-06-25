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


    // ─── DO'KON SOHASI VA AI SOZLAMALAR ─────────────────────────────────────
    sector: {
        // Asosiy soha (do'kon yaratilganda tanlanadi)
        type: String,
        enum: [
            "tort_va_shirinlik",  // 🎂 Tort va shirinlik do'koni
            "kafe_restoran",      // ☕ Kafe / Restoran
            "supermarket",        // 🛒 Supermarket / Oziq-ovqat
            "kiyim",              // 👗 Kiyim-kechak
            "elektronika",        // 📱 Elektronika
            "kosmetika",          // 💄 Kosmetika / Gozellik
            "dori_darmon",        // 💊 Dorixona
            "qurilish",           // 🏗 Qurilish materiallari
            "sport",              // ⚽ Sport mahsulotlari
            "boshqa",             // 📦 Boshqa
        ],
        default: "boshqa",
    },

    aiConfig: {
        // Ovozli sotuv: faqat sotuv parse (boshqa savollarga javob yo'q)
        voiceSaleOnly:   { type: Boolean, default: true },

        // Token tejash: agar katalogda mahsulot bo'lsa — AI ishlatmaslik
        skipAiIfCatalog: { type: Boolean, default: true },

        // Oylik token limit (0 = cheksiz)
        monthlyTokenLimit: { type: Number, default: 50000 },

        // So'rovlar orasidagi minimal interval (soniyada)
        // Spamdan himoya
        minIntervalSec:  { type: Number, default: 2 },

        // Oxirgi AI so'rov vaqti (rate limit uchun)
        lastAiRequestAt: { type: Date, default: null },
    },


    // ─── WEB APP (do'kon sayt) ───────────────────────────────────────────────
    webApp: {
        // Admin ruxsat berganmi?
        enabled:     { type: Boolean, default: false },

        // Do'kon sayt nomi (mijoz belgilaydi)
        siteName:    { type: String, default: "" },

        // Slug — URL da ishlatiladi: botpos.uz?shop=SHOPID
        // webappUrl allaqachon bor — shu ishlatiladi

        // Banner rasm URL (mijoz o'zi o'zgartiradi)
        bannerUrl:   { type: String, default: "" },

        // Guruh/kanal ID — buyurtma xabarlari ketadi
        orderChatId: { type: String, default: "" },

        // Sayt yaratilgan vaqt
        createdAt:   { type: Date, default: null },

        // Rang tema
        theme: {
            primary:    { type: String, default: "#0d0d0d" },  // Asosiy rang (tugmalar)
            accent:     { type: String, default: "#f5c842" },  // Aksent rang
            bg:         { type: String, default: "#faf6f0" },  // Fon rangi
            cardBg:     { type: String, default: "#ffffff" },  // Karta fon
            navBg:      { type: String, default: "#ffffff" },  // Navbar fon
            text:       { type: String, default: "#0d0d0d" },  // Matn rangi
            themeKey:   { type: String, default: "dark" },     // Tema kaliti
        },
        // Statistika
        totalOrders:   { type: Number, default: 0 },
        totalVisitors: { type: Number, default: 0 },
    },

    // ─── TARIF ──────────────────────────────────────────────────────────────
    plan: {
        type: String,
        enum: [
            "boshlanish",  // 🌱  99,000/oy — asosiy
            "standart",    // ⭐ 149,000/oy — + dashboard
            "pro",         // 💎 249,000/oy — + ai + qr + webapp
            "biznes",      // 🏆 399,000/oy — hammasi
        ],
        default: "boshlanish",
    },

    // ─── QO'SHIMCHA XIZMATLAR ────────────────────────────────────────────────
    // Har bir qo'shimcha alohida yoqiladi va billing ga ta'sir qiladi
    addons: {
        ai:      { type: Boolean, default: false },   // 🤖 +50,000/oy
        cashback:{ type: Boolean, default: false },   // 📱 +30,000/oy
        webapp:  { type: Boolean, default: false },   // 🌐 +50,000/oy
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
