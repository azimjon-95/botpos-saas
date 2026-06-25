// src/index.js — BOT·POS SaaS asosiy kirish nuqtasi
// FIX: Rate limiting qo'shildi, Socket.IO qo'shildi, ADMIN_PANEL_PORT olib tashlandi
"use strict";
require("dotenv").config();
const express   = require("express");
const http      = require("http");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");
const dns       = require("dns");
dns.setDefaultResultOrder("ipv4first");

const { connectDb }    = require("./db");
const { loadAllShops } = require("./saas/botManager");
const { webappRoutes }   = require("./routes/webapp");
const { billingRoutes }    = require("./routes/billing");
const { onboardingRoutes } = require("./routes/onboarding");
const { productRoutes }    = require("./routes/products");
const { webappRoutes }     = require("./routes/webapp");
const { startBillingScheduler } = require("./billing/billingNotifier");
const { startBackupScheduler }  = require("./services/backupScheduler");
const { adminRoutes }  = require("./routes/admin");
const { PORT, TZ, WEBAPP_BASE_URL, API_RATE_LIMIT } = require("./config");

process.env.TZ = TZ;

process.on("uncaughtException",  e => console.error("[uncaughtException]",  e?.message || e));
process.on("unhandledRejection", e => console.error("[unhandledRejection]", e?.message || e));

(async () => {
    try {
        // 1. MongoDB
        await connectDb();

        // 2. Express
        const app = express();
        app.set("trust proxy", 1);
        app.use(express.json({ limit: "1mb" }));

        // CORS
        // CORS — ruxsat etilgan originlar
        const ALLOWED_ORIGINS = [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://botpos.vercel.app",
            WEBAPP_BASE_URL,
        ].filter(Boolean);

        app.use(cors({
            origin: (origin, cb) => {
                if (!origin) return cb(null, true);  // Postman, curl
                const ok = ALLOWED_ORIGINS.some(o => origin.startsWith(o))
                        || origin.endsWith(".vercel.app");
                if (ok) return cb(null, true);
                cb(new Error("CORS BLOCKED: " + origin));
            },
            credentials: true,
        }));

        // Rate limiting (TZ 7 — 100 req/min)
        const apiLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: API_RATE_LIMIT,
            standardHeaders: true,
            legacyHeaders: false,
            message: { ok: false, error: "Juda ko'p so'rov. 1 daqiqadan keyin qayta urinib ko'ring." },
        });

        // Admin ga qattiqroq limit
        const adminLimiter = rateLimit({
            windowMs: 60 * 1000,
            max: 60,
            message: { ok: false, error: "Admin API limit: 60 req/min" },
        });

        // Login brute-force himoya
        const loginLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,   // 15 daqiqa
            max: 10,
            message: { ok: false, error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." },
        });

        app.use("/api", apiLimiter);
        app.use("/api/admin", adminLimiter);
        app.use("/api/admin/login", loginLimiter);

        // Routes
        app.use("/api/webapp", webappRoutes());
        app.use("/api/admin",  adminRoutes());
        app.use("/api/admin/billing", billingRoutes());
        app.use("/api/onboarding",      onboardingRoutes());  // PUBLIC
        app.use("/api",                 productRoutes());
        app.use("/api/webapp",          webappRoutes());

        app.get("/health", (req, res) =>
            res.json({ ok: true, ts: Date.now(), service: "botpos-saas", uptime: process.uptime() })
        );

        // 3. Socket.IO (real-time dashboard uchun)
        const { Server } = require("socket.io");
        const server = http.createServer(app);
        const io = new Server(server, {
            cors: {
                origin: (origin, cb) => {
                    if (!origin) return cb(null, true);
                    const ok = !origin || origin.endsWith(".vercel.app")
                            || origin.startsWith("http://localhost");
                    cb(null, ok);
                },
                methods: ["GET", "POST"],
            },
        });

        // Shop ga xos room lar
        io.on("connection", (socket) => {
            socket.on("join:shop", (shopId) => {
                if (shopId) socket.join(`shop:${shopId}`);
            });
        });

        // io ni global qilish (botManager dan emit uchun)
        global._io = io;

        server.listen(PORT, () => {
            console.log(`🌐 BOT·POS SaaS: http://localhost:${PORT}`);
            console.log(`📊 Admin API: /api/admin/*`);
            console.log(`📱 WebApp API: /api/webapp/*`);
            console.log(`⚡ Socket.IO: aktiv`);
        });

        // 4. Botlarni ishga tushirish
        await loadAllShops();

        // 5. Billing scheduler (har kuni 10:00)
        startBillingScheduler();

        // 6. Backup scheduler (har kuni 23:30 + kassa yopilganda)
        startBackupScheduler();

        console.log("✅ BOT·POS SaaS tayyor!");

    } catch (e) {
        console.error("❌ Start xato:", e);
        process.exit(1);
    }
})();
