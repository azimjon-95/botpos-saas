const { mongoose } = require("../db");

const CounterSchema = new mongoose.Schema({
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    key:    { type: String, required: true },
    value:  { type: Number, default: 0 }
}, { versionKey: false });

CounterSchema.index({ shopId: 1, key: 1 }, { unique: true });
module.exports = mongoose.model("Counter", CounterSchema);
