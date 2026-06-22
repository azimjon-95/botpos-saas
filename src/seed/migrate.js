// node src/seed/migrate.js shopId=<ID>
require("dotenv").config();
const { connectDb } = require("../db");
const Shop     = require("../models/Shop");
const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Debt     = require("../models/Debt");
const Worker   = require("../models/Worker");
const Customer = require("../models/Customer");

(async () => {
    await connectDb();
    const shopId = process.argv[2]?.split("=")?.[1];
    if (!shopId) { console.error("Ishlatilishi: node src/seed/migrate.js shopId=<ID>"); process.exit(1); }
    const shop = await Shop.findById(shopId);
    if (!shop) { console.error("Do'kon topilmadi:", shopId); process.exit(1); }

    for (const [M, name] of [[Sale,"Sale"],[Expense,"Expense"],[Debt,"Debt"],[Worker,"Worker"],[Customer,"Customer"]]) {
        const r = await M.updateMany({ shopId: { $exists: false } }, { $set: { shopId: shop._id } });
        console.log(`✅ ${name}: ${r.modifiedCount} ta yangilandi`);
    }
    console.log("\n✅ Migratsiya tugadi:", shop.name);
    process.exit(0);
})();
