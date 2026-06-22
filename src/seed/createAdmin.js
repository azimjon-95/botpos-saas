require("dotenv").config();
const { connectDb } = require("../db");
const SuperAdmin    = require("../models/SuperAdmin");
const bcrypt        = require("bcryptjs");
const { ADMIN_EMAIL } = require("../config");

(async () => {
    try {
        await connectDb();
        const email    = ADMIN_EMAIL || "admin@botpos.uz";
        const password = process.argv[2] || "Admin@12345";
        const exists   = await SuperAdmin.findOne({ email });
        if (exists) { console.log("⚠️ Admin mavjud:", email); process.exit(0); }
        const hash = await bcrypt.hash(password, 12);
        await SuperAdmin.create({ email, passwordHash: hash });
        console.log("✅ Super admin yaratildi!\n📧", email, "\n🔑", password);
        console.log("\n⚠️ Parolni o'zgartiring!");
        process.exit(0);
    } catch (e) { console.error("❌", e.message); process.exit(1); }
})();
