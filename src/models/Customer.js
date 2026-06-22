const { mongoose } = require("../db");

const CustomerSchema = new mongoose.Schema({
    shopId:    { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    tgId:      { type: Number, required: true, index: true },
    tgName:    { type: String, default: "" },
    points:    { type: Number, default: 0 },
    refCount:  { type: Number, default: 0 },
    refPoints: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

CustomerSchema.index({ shopId: 1, tgId: 1 }, { unique: true });
module.exports = mongoose.model("Customer", CustomerSchema);
