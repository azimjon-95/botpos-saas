// src/index.js — BOT·POS SaaS asosiy kirish nuqtasi
require("dotenv").config();
const express    = require("express");
const http       = require("http");
const cors       = require("cors");
const dns        = require("dns");
dns.setDefaultResultOrder("ipv4first");

const { connectDb }      = require("./db");
const { loadAllShops }   = require("./saas/botManager");
const { webappRoutes }   = require("./routes/webapp");
const { adminRoutes }    = require("./routes/admin");
const { PORT, ADMIN_PANEL_PORT, TZ, WEBAPP_BASE_URL } = require("./config");

process.env.TZ = TZ || "Asia/Tashkent";

process.on("uncaughtException",  e => console.error("[uncaughtException]",  e?.message || e));
process.on("unhandledRejection", e => console.error("[unhandledRejection]", e?.message || e));

(async () => {
    try {
        // 1️⃣ MongoDB
        await connectDb();

        // 2️⃣ Express server (WebApp API)
        const app = express();
        app.use(express.json({ limit: "1mb" }));
        app.use(cors({
            origin: (origin, cb) => {
                if (!origin) return cb(null, true);
                if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) return cb(null, true);
                if (WEBAPP_BASE_URL && origin.startsWith(WEBAPP_BASE_URL)) return cb(null, true);
                cb(new Error("CORS BLOCKED"));
            },
            credentials: true,
        }));

        // WebApp API
        app.use("/api/webapp", webappRoutes());

        // Admin API (alohida - bu ham asosiy serverda, port orqali ajratish mumkin)
        app.use("/api/admin", adminRoutes());

        app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now(), service: "botpos-saas" }));
        app.get("/api/bots/status", (req, res) => {
            const { getStatus } = require("./saas/botManager");
            res.json({ ok: true, data: getStatus() });
        });

        const server = http.createServer(app);
        server.listen(PORT, () => {
            console.log(`🌐 BOT·POS SaaS server: http://localhost:${PORT}`);
        });

        // 3️⃣ Barcha faol do'konlar botlarini ishga tushirish
        await loadAllShops();

        console.log("✅ BOT·POS SaaS tayyor!");
        console.log(`📊 Admin API: /api/admin/*`);
        console.log(`📱 WebApp API: /api/webapp/* (shopId talab qilinadi)`);

    } catch (e) {
        console.error("❌ Start xato:", e);
        process.exit(1);
    }
})();
