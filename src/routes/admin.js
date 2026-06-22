// src/routes/admin.js — Super Admin API (TZ 5 bo'yicha)
const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const Shop     = require("../models/Shop");
const AuditLog = require("../models/AuditLog");
const SuperAdmin = require("../models/SuperAdmin");
const { adminAuth } = require("../middlewares/adminAuth");
const { encrypt }   = require("../utils/encrypt");
const { reloadShop, stopShopBot, startShopBot, getStatus } = require("../saas/botManager");
const { ADMIN_JWT_SECRET, WEBAPP_BASE_URL } = require("../config");

function adminRoutes() {
    const r = express.Router();

    // ─── LOGIN ──────────────────────────────────────────────────
    // POST /api/admin/login  { email, password }
    r.post("/login", async (req, res) => {
        try {
            const { email, password } = req.body || {};
            if (!email || !password) return res.status(400).json({ ok: false, error: "email va password kerak" });

            const admin = await SuperAdmin.findOne({ email: email.toLowerCase() });
            if (!admin) return res.status(401).json({ ok: false, error: "Noto'g'ri login" });

            const ok = await bcrypt.compare(password, admin.passwordHash);
            if (!ok) return res.status(401).json({ ok: false, error: "Noto'g'ri parol" });

            await SuperAdmin.updateOne({ _id: admin._id }, { lastLogin: new Date() });

            const token = jwt.sign({ email: admin.email }, ADMIN_JWT_SECRET, { expiresIn: "1h" });
            const refresh = jwt.sign({ email: admin.email, type: "refresh" }, ADMIN_JWT_SECRET, { expiresIn: "7d" });

            res.json({ ok: true, data: { token, refresh } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── TOKEN YANGILASH ─────────────────────────────────────────
    r.post("/refresh", async (req, res) => {
        try {
            const { refresh } = req.body || {};
            const payload = jwt.verify(refresh, ADMIN_JWT_SECRET);
            if (payload.type !== "refresh") throw new Error("Noto'g'ri token turi");
            const token = jwt.sign({ email: payload.email }, ADMIN_JWT_SECRET, { expiresIn: "1h" });
            res.json({ ok: true, data: { token } });
        } catch {
            res.status(401).json({ ok: false, error: "Refresh token noto'g'ri" });
        }
    });

    // ─── BARCHA ENDPOINTLAR AUTHLANGAN ──────────────────────────
    r.use(adminAuth);

    // ─── DO'KONLAR RO'YXATI ──────────────────────────────────────
    // GET /api/admin/shops?page=1&limit=20&search=totli&plan=pro
    r.get("/shops", async (req, res) => {
        try {
            const { page = 1, limit = 20, search, plan, isActive } = req.query;
            const filter = {};
            if (search) filter.name = { $regex: search, $options: "i" };
            if (plan) filter.plan = plan;
            if (isActive !== undefined) filter.isActive = isActive === "true";

            const [shops, total] = await Promise.all([
                Shop.find(filter)
                    .select("-botToken -customerBotToken -openaiKey")
                    .sort({ createdAt: -1 })
                    .skip((page - 1) * limit)
                    .limit(Number(limit))
                    .lean(),
                Shop.countDocuments(filter)
            ]);

            // Bot holatlari
            const botStatus = getStatus();
            const statusMap = {};
            botStatus.forEach(s => { statusMap[String(s.shopId)] = s; });

            const result = shops.map(s => ({
                ...s,
                botRunning: !!statusMap[String(s._id)]?.botActive,
                customerBotRunning: !!statusMap[String(s._id)]?.customerBotActive,
            }));

            res.json({ ok: true, data: { shops: result, total, page: Number(page), limit: Number(limit) } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── DO'KON BATAFSIL ────────────────────────────────────────
    r.get("/shops/:id", async (req, res) => {
        try {
            const shop = await Shop.findById(req.params.id).select("-botToken -customerBotToken -openaiKey").lean();
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: shop });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── YANGI DO'KON QO'SHISH ─────────────────────────────────
    // POST /api/admin/shops  { name, ownerName, phone, address, botToken, groupChatId, ... }
    r.post("/shops", async (req, res) => {
        try {
            const {
                name, ownerName, phone, address,
                botToken, customerBotToken, customerBotUsername,
                groupChatId, openaiKey,
                bakerTgId, adminTgId, minQrPaid, botPassword,
                plan, notes, statsChatId, backupChatId
            } = req.body || {};

            if (!name || !ownerName || !phone || !botToken || !groupChatId) {
                return res.status(400).json({ ok: false, error: "Majburiy maydonlar: name, ownerName, phone, botToken, groupChatId" });
            }

            // Tokenlarni shifrlash
            const shop = await Shop.create({
                name, ownerName, phone, address: address || "",
                botToken:         encrypt(botToken),
                customerBotToken: customerBotToken ? encrypt(customerBotToken) : "",
                customerBotUsername: customerBotUsername || "",
                groupChatId,
                openaiKey: openaiKey ? encrypt(openaiKey) : "",
                bakerTgId:   bakerTgId   || null,
                statsChatId: statsChatId || null,
                backupChatId: backupChatId || null,
                adminTgId:   Number(adminTgId) || 0,
                minQrPaid:   Number(minQrPaid) || 70000,
                botPassword: botPassword || "1234",
                plan:        plan || "starter",
                notes:       notes || "",
                webappUrl:   `${WEBAPP_BASE_URL}?shop=`,  // ID qo'shiladi keyinroq
            });

            // webappUrl ni yangilash
            await Shop.findByIdAndUpdate(shop._id, {
                webappUrl: `${WEBAPP_BASE_URL}?shop=${shop._id}`
            });

            // Botni ishga tushirish
            try {
                await startShopBot(await Shop.findById(shop._id).lean());
            } catch (e) {
                console.error("[admin] bot start xato:", e.message);
            }

            // Audit log
            await AuditLog.create({
                adminEmail: req.adminEmail,
                action: "shop.create",
                shopId: shop._id, shopName: name,
                details: { plan, phone }, ip: req.ip
            });

            res.status(201).json({ ok: true, data: { shopId: shop._id, name, webappUrl: `${WEBAPP_BASE_URL}?shop=${shop._id}` } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── DO'KON TAHRIRLASH ───────────────────────────────────────
    r.put("/shops/:id", async (req, res) => {
        try {
            const allowed = ["name", "ownerName", "phone", "address", "groupChatId",
                "customerBotUsername", "bakerTgId", "adminTgId", "minQrPaid",
                "botPassword", "plan", "notes", "statsChatId", "backupChatId"];
            const update = {};
            for (const key of allowed) {
                if (req.body[key] !== undefined) update[key] = req.body[key];
            }
            // Shifrlangan maydonlar alohida
            if (req.body.botToken)         update.botToken         = encrypt(req.body.botToken);
            if (req.body.customerBotToken) update.customerBotToken = encrypt(req.body.customerBotToken);
            if (req.body.openaiKey)        update.openaiKey        = encrypt(req.body.openaiKey);

            const shop = await Shop.findByIdAndUpdate(req.params.id, update, { new: true }).select("-botToken -customerBotToken -openaiKey");
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            // Botni restart qilish
            await reloadShop(req.params.id);

            await AuditLog.create({
                adminEmail: req.adminEmail, action: "shop.edit",
                shopId: shop._id, shopName: shop.name,
                details: Object.keys(update), ip: req.ip
            });

            res.json({ ok: true, data: shop });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── DO'KON TO'XTATISH / FAOLLASHTIRISH ─────────────────────
    r.patch("/shops/:id/toggle", async (req, res) => {
        try {
            const shop = await Shop.findById(req.params.id);
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            const newActive = !shop.isActive;
            shop.isActive  = newActive;
            shop.stoppedAt = newActive ? null : new Date();
            await shop.save();

            if (newActive) {
                await startShopBot(shop.toObject());
            } else {
                await stopShopBot(req.params.id);
            }

            await AuditLog.create({
                adminEmail: req.adminEmail,
                action: newActive ? "shop.activate" : "shop.stop",
                shopId: shop._id, shopName: shop.name, ip: req.ip
            });

            res.json({ ok: true, data: { isActive: newActive } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── DO'KON BOTINI RESTART ───────────────────────────────────
    r.post("/shops/:id/restart", async (req, res) => {
        try {
            await reloadShop(req.params.id);
            await AuditLog.create({
                adminEmail: req.adminEmail, action: "shop.restart",
                shopId: req.params.id, ip: req.ip
            });
            res.json({ ok: true, message: "Bot restart qilindi" });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── STATISTIKA ──────────────────────────────────────────────
    r.get("/stats", async (req, res) => {
        try {
            const [total, active, starter, pro, business] = await Promise.all([
                Shop.countDocuments(),
                Shop.countDocuments({ isActive: true }),
                Shop.countDocuments({ plan: "starter" }),
                Shop.countDocuments({ plan: "pro" }),
                Shop.countDocuments({ plan: "business" }),
            ]);
            const botStatus = getStatus();
            res.json({ ok: true, data: {
                shops: { total, active, stopped: total - active },
                plans: { starter, pro, business },
                botsRunning: botStatus.length,
            }});
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── AUDIT LOG ───────────────────────────────────────────────
    r.get("/audit", async (req, res) => {
        try {
            const { page = 1, limit = 30 } = req.query;
            const logs = await AuditLog.find()
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit))
                .lean();
            res.json({ ok: true, data: logs });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── BOT HOLATLARI ───────────────────────────────────────────
    r.get("/bots/status", async (req, res) => {
        res.json({ ok: true, data: getStatus() });
    });

    return r;
}

module.exports = { adminRoutes };
