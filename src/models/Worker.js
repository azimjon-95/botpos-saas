const { mongoose } = require("../db");

const WorkerSchema = new mongoose.Schema({
    shopId:       { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    tgId:         { type: Number, required: true },
    username:     { type: String, default: "" },
    fullName:     { type: String, default: "" },
    role:         { type: String, default: "worker" },
    canUseWebApp: { type: Boolean, default: true },
    isActive:     { type: Boolean, default: true }
}, { timestamps: true, versionKey: false });

WorkerSchema.index({ shopId: 1, tgId: 1 }, { unique: true });
module.exports = mongoose.model("Worker", WorkerSchema);
