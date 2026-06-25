// src/models/Order.js — Web app orqali kelgan buyurtmalar
"use strict";
const { mongoose } = require("../db");

const OrderItemSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name:      { type: String, required: true },
    price:     { type: Number, required: true },
    qty:       { type: Number, default: 1 },
    total:     { type: Number, required: true },
}, { _id: false });

const OrderSchema = new mongoose.Schema({
    shopId:    { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },

    // Buyurtmachi
    clientName:  { type: String, required: true },
    clientPhone: { type: String, required: true },
    clientNote:  { type: String, default: "" },

    // Mahsulotlar
    items:     [OrderItemSchema],
    total:     { type: Number, required: true },

    // Holat
    status: {
        type: String,
        enum: ["new", "confirmed", "delivering", "done", "cancelled"],
        default: "new",
        index: true,
    },

    // Telegram xabar ID (do'kon egasiga yuborilgan)
    tgMsgId:   { type: Number, default: null },
    tgChatId:  { type: String, default: null },

}, { timestamps: true, versionKey: false });

OrderSchema.index({ shopId: 1, createdAt: -1 });
OrderSchema.index({ shopId: 1, status: 1 });

module.exports = mongoose.model("Order", OrderSchema);
