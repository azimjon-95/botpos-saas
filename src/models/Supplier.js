const { mongoose } = require("../db");

const SupplierSchema = new mongoose.Schema({
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    name:   { type: String, required: true },
    phone:  { type: String, default: "" },
    debt:   { type: Number, default: 0 }
}, { timestamps: true, versionKey: false });

SupplierSchema.index({ shopId: 1 });
module.exports = mongoose.model("Supplier", SupplierSchema);
