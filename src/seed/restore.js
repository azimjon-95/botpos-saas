// node src/seed/restore.js <backup_file.json> [shopId]
// Backup fayldan ma'lumotlarni tiklash
require("dotenv").config();
const path = require("path");
const { connectDb } = require("../db");
const { restoreFromFile } = require("../services/backup");

const file     = process.argv[2];
const shopId   = process.argv[3];

if (!file) {
    console.error("❌ Misol: node src/seed/restore.js backup.json [shopId]");
    process.exit(1);
}

(async () => {
    try {
        await connectDb();
        console.log(`📂 Fayl: ${path.resolve(file)}`);
        if (shopId) console.log(`🏪 ShopId: ${shopId}`);
        console.log("⏳ Tiklanmoqda...\n");

        const results = await restoreFromFile(path.resolve(file), shopId);

        let total = 0;
        for (const [col, res] of Object.entries(results)) {
            if (res.skipped) console.log(`  ${col.padEnd(12)} — bo'sh`);
            else if (res.error) console.log(`  ${col.padEnd(12)} — ❌ ${res.error}`);
            else { console.log(`  ${col.padEnd(12)} — ✅ ${res.inserted}/${res.total}`); total += res.inserted || 0; }
        }
        console.log(`\n✅ Jami: ${total} ta hujjat tiklandi`);
        process.exit(0);
    } catch (e) {
        console.error("❌", e.message);
        process.exit(1);
    }
})();
