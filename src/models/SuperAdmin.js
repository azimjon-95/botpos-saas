const { mongoose } = require("../db");

const SuperAdminSchema = new mongoose.Schema({
    email:        { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    totpSecret:   { type: String, default: "" },   // 2FA uchun
    is2FAEnabled: { type: Boolean, default: false },
    lastLogin:    { type: Date, default: null }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("SuperAdmin", SuperAdminSchema);
