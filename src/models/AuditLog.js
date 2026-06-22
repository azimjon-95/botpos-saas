const { mongoose } = require("../db");

const AuditLogSchema = new mongoose.Schema({
    adminEmail: { type: String, required: true },
    action:     { type: String, required: true },   // "shop.create" | "shop.stop" | "shop.edit"
    shopId:     { type: mongoose.Schema.Types.ObjectId, default: null },
    shopName:   { type: String, default: "" },
    details:    { type: mongoose.Schema.Types.Mixed, default: {} },
    ip:         { type: String, default: "" }
}, { timestamps: true, versionKey: false });

AuditLogSchema.index({ createdAt: -1 });
module.exports = mongoose.model("AuditLog", AuditLogSchema);
