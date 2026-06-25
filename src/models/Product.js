// src/models/Product.js — Mahsulotlar katalogi
// Har do'kon o'z mahsulotlarini qo'shadi
// Sotuvchi tugma bosib tanlaydi — yozmasdan sotuv qiladi
"use strict";
const { mongoose } = require("../db");

const ProductSchema = new mongoose.Schema({
    shopId:   { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },

    // ─── Kategoriya ─────────────────────────────────────────────────────────
    // Har do'kon o'z kategoriyalarini belgilaydi (hardcode emas)
    category: { type: String, required: true, trim: true },   // "Tortlar", "Ichimliklar"
    emoji:    { type: String, default: "🛍" },                // Kategoriya emoji

    // ─── Mahsulot ────────────────────────────────────────────────────────────
    name:     { type: String, required: true, trim: true },   // "Napoleon tort"
    price:    { type: Number, required: true },                // 140000
    unit:     { type: String, default: "dona" },               // dona, kg, litr

    // ─── Holat ───────────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    sortOrder:{ type: Number, default: 0 },                   // Tartib

}, { timestamps: true, versionKey: false });

ProductSchema.index({ shopId: 1, category: 1, isActive: 1 });
ProductSchema.index({ shopId: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("Product", ProductSchema);
