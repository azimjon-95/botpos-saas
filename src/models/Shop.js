const { mongoose } = require("../db");

const ShopSchema = new mongoose.Schema({
    name:             { type: String, required: true, trim: true },
    ownerName:        { type: String, required: true, trim: true },
    phone:            { type: String, required: true, trim: true },
    address:          { type: String, default: "", trim: true },
    subdomain:        { type: String, default: null, unique: true, sparse: true },
    botToken:         { type: String, required: true },
    customerBotToken: { type: String, default: "" },
    customerBotUsername: { type: String, default: "" },
    groupChatId:      { type: String, required: true },
    backupChatId:     { type: String, default: null },
    openaiKey:        { type: String, default: "" },
    bakerTgId:        { type: String, default: null },
    statsChatId:      { type: String, default: null },
    adminTgId:        { type: Number, default: 0 },
    minQrPaid:        { type: Number, default: 70000 },
    botPassword:      { type: String, default: "1234" },
    plan:             { type: String, enum: ["starter", "pro", "business"], default: "starter" },
    isActive:         { type: Boolean, default: true, index: true },
    stoppedAt:        { type: Date, default: null },
    webappUrl:        { type: String, default: "" },
    notes:            { type: String, default: "" },
}, { timestamps: true, versionKey: false });

ShopSchema.index({ isActive: 1, createdAt: -1 });
module.exports = mongoose.model("Shop", ShopSchema);
