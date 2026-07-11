// scripts/create-admin.js
// .env dan ADMIN_EMAIL + ADMIN_PASSWORD o'qib admin yaratadi
// Ishlatish: node scripts/create-admin.js
"use strict";
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const MONGO_URI   = process.env.MONGO_URI;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL    || "admin@botpos.uz";
const ADMIN_PASS  = process.env.ADMIN_PASSWORD;

if (!MONGO_URI)             { console.error("❌ MONGO_URI .env da yo'q");       process.exit(1); }
if (!ADMIN_PASS)            { console.error("❌ ADMIN_PASSWORD .env da yo'q");   process.exit(1); }
if (ADMIN_PASS.length < 6)  { console.error("❌ ADMIN_PASSWORD kamida 6 belgi"); process.exit(1); }

const SuperAdmin = require("../src/models/SuperAdmin");

async function main() {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB ulandi");

    // Mavjud adminlarni ko'rsatamiz
    const all = await SuperAdmin.find().select("email createdAt").lean();
    if (all.length) {
        console.log("\n📋 Mavjud adminlar:");
        all.forEach(a => console.log(`   - ${a.email}`));
    }

    const hash     = await bcrypt.hash(ADMIN_PASS, 12);
    const existing = await SuperAdmin.findOne({ email: ADMIN_EMAIL.toLowerCase() });

    if (existing) {
        await SuperAdmin.updateOne({ _id: existing._id }, {
            $set: { passwordHash: hash, is2FAEnabled: false }
        });
        console.log(`\n✅ Admin yangilandi: ${ADMIN_EMAIL}`);
    } else {
        await SuperAdmin.create({
            email:        ADMIN_EMAIL.toLowerCase(),
            passwordHash: hash,
            is2FAEnabled: false,
        });
        console.log(`\n✅ Yangi admin yaratildi: ${ADMIN_EMAIL}`);
    }

    console.log(`\n📋 Login ma'lumotlari:`);
    console.log(`   Email : ${ADMIN_EMAIL}`);
    console.log(`   Parol : ${ADMIN_PASS}`);
    console.log(`\n🌐 http://localhost:3000/login\n`);

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
