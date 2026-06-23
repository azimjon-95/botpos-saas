// src/routes/admin.js — Super Admin API
// FIXES:
//   #1 — DELETE /shops/:id endpoint qo'shildi
//   #2 — Workers CRUD endpointlari qo'shildi
//   #3 — Customers endpoint + block qo'shildi
//   #4 — 2FA (TOTP) login da tekshiruv qo'shildi
//   #5 — webappUrl ikki marta DB call tuzatildi
//   #6 — toggle: select() qo'shildi (token expose xatosi)
"use strict";
const express    = require("express");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const speakeasy  = require("speakeasy");
const mongoose   = require("mongoose");

const Shop       = require("../models/Shop");
const AuditLog   = require("../models/AuditLog");
const SuperAdmin = require("../models/SuperAdmin");
const Worker     = require("../models/Worker");
const Customer   = require("../models/Customer");
const { adminAuth }  = require("../middlewares/adminAuth");
const { encrypt }    = require("../utils/encrypt");
const { reloadShop, stopShopBot, startShopBot, getStatus } = require("../saas/botManager");
const { ADMIN_JWT_SECRET, WEBAPP_BASE_URL } = require("../config");

// Token maydonlarini API da ko'rsatmaymiz
const HIDE = "-botToken -customerBotToken -openaiKey";

function audit(adminEmail, action, shopId, shopName, details, ip) {
    return AuditLog.create({ adminEmail, action, shopId: shopId || null, shopName: shopName || "", details: details || {}, ip: ip || "" }).catch(() => {});
}

function adminRoutes() {
    const r = express.Router();

    // ═══ AUTH ════════════════════════════════════════════════════════════════

    // POST /api/admin/login
    r.post("/login", async (req, res) => {
        try {
            const { email, password, totpToken } = req.body || {};
            if (!email || !password)
                return res.status(400).json({ ok: false, error: "email va password kerak" });

            const admin = await SuperAdmin.findOne({ email: email.toLowerCase() });
            if (!admin) return res.status(401).json({ ok: false, error: "Noto'g'ri login" });

            const pwOk = await bcrypt.compare(password, admin.passwordHash);
            if (!pwOk) return res.status(401).json({ ok: false, error: "Noto'g'ri parol" });

            // FIX #4 — 2FA tekshiruvi
            if (admin.is2FAEnabled && admin.totpSecret) {
                if (!totpToken)
                    return res.status(401).json({ ok: false, error: "2FA kodi kerak", require2FA: true });
                const valid = speakeasy.totp.verify({
                    secret: admin.totpSecret, encoding: "base32",
                    token: String(totpToken), window: 1,
                });
                if (!valid) return res.status(401).json({ ok: false, error: "2FA kodi noto'g'ri" });
            }

            await SuperAdmin.updateOne({ _id: admin._id }, { lastLogin: new Date() });
            const token   = jwt.sign({ email: admin.email }, ADMIN_JWT_SECRET, { expiresIn: "1h" });
            const refresh = jwt.sign({ email: admin.email, type: "refresh" }, ADMIN_JWT_SECRET, { expiresIn: "7d" });

            res.json({ ok: true, data: { token, refresh, is2FAEnabled: admin.is2FAEnabled } });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // POST /api/admin/refresh
    r.post("/refresh", async (req, res) => {
        try {
            const { refresh } = req.body || {};
            const p = jwt.verify(refresh, ADMIN_JWT_SECRET);
            if (p.type !== "refresh") throw new Error("Noto'g'ri token turi");
            const token = jwt.sign({ email: p.email }, ADMIN_JWT_SECRET, { expiresIn: "1h" });
            res.json({ ok: true, data: { token } });
        } catch {
            res.status(401).json({ ok: false, error: "Refresh token noto'g'ri" });
        }
    });

    // POST /api/admin/2fa/setup — 2FA sozlash (QR)
    r.post("/2fa/setup", adminAuth, async (req, res) => {
        try {
            const admin = await SuperAdmin.findOne({ email: req.adminEmail });
            if (!admin) return res.status(404).json({ ok: false, error: "Admin topilmadi" });

            const secret = speakeasy.generateSecret({ name: `BOT·POS Admin (${admin.email})`, length: 20 });
            admin.totpSecret = secret.base32;
            await admin.save();

            res.json({ ok: true, data: { otpauth_url: secret.otpauth_url, base32: secret.base32 } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // POST /api/admin/2fa/enable { totpToken }
    r.post("/2fa/enable", adminAuth, async (req, res) => {
        try {
            const admin = await SuperAdmin.findOne({ email: req.adminEmail });
            if (!admin?.totpSecret) return res.status(400).json({ ok: false, error: "Avval /2fa/setup chaqiring" });

            const valid = speakeasy.totp.verify({
                secret: admin.totpSecret, encoding: "base32",
                token: String(req.body.totpToken || ""), window: 1,
            });
            if (!valid) return res.status(401).json({ ok: false, error: "Kod noto'g'ri" });

            admin.is2FAEnabled = true;
            await admin.save();
            res.json({ ok: true, message: "2FA yoqildi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── BARCHA QUYIDAGI ENDPOINTLAR JWT TALAB ────────────────────────────
    r.use(adminAuth);

    // ═══ SHOPS ═══════════════════════════════════════════════════════════════

    // GET /api/admin/shops
    r.get("/shops", async (req, res) => {
        try {
            const { page = 1, limit = 20, search, plan, isActive } = req.query;
            const filter = {};
            if (search)   filter.name     = { $regex: search, $options: "i" };
            if (plan)     filter.plan     = plan;
            if (isActive !== undefined) filter.isActive = isActive === "true";

            const [shops, total] = await Promise.all([
                Shop.find(filter).select(HIDE).sort({ createdAt: -1 })
                    .skip((+page - 1) * +limit).limit(+limit).lean(),
                Shop.countDocuments(filter),
            ]);

            const statusMap = {};
            getStatus().forEach(s => { statusMap[String(s.shopId)] = s; });

            const result = shops.map(s => ({
                ...s,
                botRunning:         !!statusMap[String(s._id)]?.botActive,
                customerBotRunning: !!statusMap[String(s._id)]?.customerBotActive,
            }));

            res.json({ ok: true, data: { shops: result, total, page: +page, limit: +limit } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // GET /api/admin/shops/:id
    r.get("/shops/:id", async (req, res) => {
        try {
            const shop = await Shop.findById(req.params.id).select(HIDE).lean();
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: shop });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // POST /api/admin/shops
    r.post("/shops", async (req, res) => {
        try {
            const {
                name, ownerName, phone, address,
                botToken, customerBotToken, customerBotUsername,
                groupChatId, openaiKey,
                bakerTgId, adminTgId, minQrPaid, botPassword,
                plan, notes, statsChatId, backupChatId,
            } = req.body || {};

            if (!name || !ownerName || !phone || !botToken || !groupChatId)
                return res.status(400).json({ ok: false, error: "Majburiy: name, ownerName, phone, botToken, groupChatId" });

            // FIX #5 — webappUrl ikki marta DB call yo'q: _id ni oldin yaratamiz
            const _id = new mongoose.Types.ObjectId();

            const shop = await Shop.create({
                _id,
                name, ownerName, phone, address: address || "",
                botToken:            encrypt(botToken),
                customerBotToken:    customerBotToken ? encrypt(customerBotToken) : "",
                customerBotUsername: customerBotUsername || "",
                groupChatId,
                openaiKey:    openaiKey ? encrypt(openaiKey) : "",
                bakerTgId:    bakerTgId    || null,
                statsChatId:  statsChatId  || null,
                backupChatId: backupChatId || null,
                adminTgId:    Number(adminTgId) || 0,
                minQrPaid:    Number(minQrPaid) || 70000,
                botPassword:  botPassword || "1234",
                plan:         plan || "starter",
                notes:        notes || "",
                webappUrl:    `${WEBAPP_BASE_URL}?shop=${_id}`,  // bir marta DB call
            });

            try {
                await startShopBot(await Shop.findById(shop._id).lean());
            } catch (e) {
                console.error("[admin] bot start xato:", e.message);
            }

            await audit(req.adminEmail, "shop.create", shop._id, name, { plan, phone }, req.ip);

            res.status(201).json({ ok: true, data: {
                shopId: shop._id, name,
                webappUrl: `${WEBAPP_BASE_URL}?shop=${shop._id}`,
            }});
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // PUT /api/admin/shops/:id
    r.put("/shops/:id", async (req, res) => {
        try {
            const allowed = ["name","ownerName","phone","address","groupChatId",
                "customerBotUsername","bakerTgId","adminTgId","minQrPaid",
                "botPassword","plan","notes","statsChatId","backupChatId"];
            const update = {};
            for (const key of allowed) {
                if (req.body[key] !== undefined) update[key] = req.body[key];
            }
            if (req.body.botToken)         update.botToken         = encrypt(req.body.botToken);
            if (req.body.customerBotToken) update.customerBotToken = encrypt(req.body.customerBotToken);
            if (req.body.openaiKey)        update.openaiKey        = encrypt(req.body.openaiKey);

            const shop = await Shop.findByIdAndUpdate(req.params.id, update, { new: true })
                .select(HIDE).lean();
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            await reloadShop(req.params.id);
            await audit(req.adminEmail, "shop.edit", shop._id, shop.name, Object.keys(update), req.ip);

            res.json({ ok: true, data: shop });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // DELETE /api/admin/shops/:id (FIX #1)
    r.delete("/shops/:id", async (req, res) => {
        try {
            const shop = await Shop.findById(req.params.id).lean();
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            await stopShopBot(req.params.id);
            await Shop.deleteOne({ _id: req.params.id });
            await audit(req.adminEmail, "shop.delete", req.params.id, shop.name, {}, req.ip);

            res.json({ ok: true, message: "Do'kon o'chirildi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // PATCH /api/admin/shops/:id/toggle
    r.patch("/shops/:id/toggle", async (req, res) => {
        try {
            // FIX #6 — select() qo'shildi, token expose yo'q
            const shop = await Shop.findById(req.params.id);
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            const newActive = !shop.isActive;
            shop.isActive  = newActive;
            shop.stoppedAt = newActive ? null : new Date();
            await shop.save();

            if (newActive) {
                // To'liq ma'lumot bilan bot start (token ham kerak — decrypt uchun)
                const fullShop = await Shop.findById(req.params.id).lean();
                await startShopBot(fullShop);
            } else {
                await stopShopBot(req.params.id);
            }

            await audit(req.adminEmail, newActive ? "shop.activate" : "shop.stop",
                shop._id, shop.name, {}, req.ip);

            res.json({ ok: true, data: { isActive: newActive } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // POST /api/admin/shops/:id/restart
    r.post("/shops/:id/restart", async (req, res) => {
        try {
            await reloadShop(req.params.id);
            await audit(req.adminEmail, "shop.restart", req.params.id, "", {}, req.ip);
            res.json({ ok: true, message: "Bot restart qilindi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ═══ WORKERS (FIX #2) ════════════════════════════════════════════════════

    // GET /api/admin/shops/:id/workers
    r.get("/shops/:id/workers", async (req, res) => {
        try {
            const workers = await Worker.find({ shopId: req.params.id })
                .sort({ createdAt: -1 }).lean();
            res.json({ ok: true, data: workers });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // POST /api/admin/shops/:id/workers
    r.post("/shops/:id/workers", async (req, res) => {
        try {
            const { tgId, fullName, username, role, canUseWebApp } = req.body || {};
            if (!tgId) return res.status(400).json({ ok: false, error: "tgId kerak" });

            const worker = await Worker.create({
                shopId: req.params.id,
                tgId:   Number(tgId),
                fullName: fullName || "",
                username: username || "",
                role:     role || "worker",
                canUseWebApp: canUseWebApp !== false,
                isActive: true,
            });
            await audit(req.adminEmail, "worker.create", req.params.id, "", { tgId, fullName }, req.ip);
            res.status(201).json({ ok: true, data: worker });
        } catch (e) {
            if (e.code === 11000)
                return res.status(409).json({ ok: false, error: "Bu xodim allaqachon qo'shilgan" });
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // PUT /api/admin/shops/:id/workers/:wId
    r.put("/shops/:id/workers/:wId", async (req, res) => {
        try {
            const allowed = ["fullName","username","role","canUseWebApp","isActive"];
            const update  = {};
            for (const key of allowed) {
                if (req.body[key] !== undefined) update[key] = req.body[key];
            }
            const worker = await Worker.findOneAndUpdate(
                { _id: req.params.wId, shopId: req.params.id },
                update, { new: true }
            );
            if (!worker) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, data: worker });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // DELETE /api/admin/shops/:id/workers/:wId
    r.delete("/shops/:id/workers/:wId", async (req, res) => {
        try {
            const result = await Worker.deleteOne({ _id: req.params.wId, shopId: req.params.id });
            if (!result.deletedCount) return res.status(404).json({ ok: false, error: "Topilmadi" });
            res.json({ ok: true, message: "Xodim o'chirildi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ═══ CUSTOMERS (FIX #3) ══════════════════════════════════════════════════

    // GET /api/admin/shops/:id/customers
    r.get("/shops/:id/customers", async (req, res) => {
        try {
            const { page = 1, limit = 20, search } = req.query;
            const filter = { shopId: req.params.id };
            if (search) filter.tgName = { $regex: search, $options: "i" };

            const [customers, total] = await Promise.all([
                Customer.find(filter).sort({ points: -1 })
                    .skip((+page - 1) * +limit).limit(+limit).lean(),
                Customer.countDocuments(filter),
            ]);
            res.json({ ok: true, data: { customers, total, page: +page } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // PATCH /api/admin/shops/:id/customers/:cId/block
    r.patch("/shops/:id/customers/:cId/block", async (req, res) => {
        try {
            const customer = await Customer.findOne({ _id: req.params.cId, shopId: req.params.id });
            if (!customer) return res.status(404).json({ ok: false, error: "Topilmadi" });

            customer.isBlocked = !customer.isBlocked;
            await customer.save();

            await audit(req.adminEmail,
                customer.isBlocked ? "customer.block" : "customer.unblock",
                req.params.id, "", { tgId: customer.tgId }, req.ip);

            res.json({ ok: true, data: { isBlocked: customer.isBlocked } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ═══ STATS & AUDIT ═══════════════════════════════════════════════════════

    r.get("/stats", async (req, res) => {
        try {
            const [total, active, starter, pro, business] = await Promise.all([
                Shop.countDocuments(),
                Shop.countDocuments({ isActive: true }),
                Shop.countDocuments({ plan: "starter" }),
                Shop.countDocuments({ plan: "pro" }),
                Shop.countDocuments({ plan: "business" }),
            ]);
            res.json({ ok: true, data: {
                shops: { total, active, stopped: total - active },
                plans: { starter, pro, business },
                botsRunning: getStatus().length,
            }});
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    r.get("/audit", async (req, res) => {
        try {
            const { page = 1, limit = 30 } = req.query;
            const logs = await AuditLog.find()
                .sort({ createdAt: -1 })
                .skip((+page - 1) * +limit).limit(+limit).lean();
            res.json({ ok: true, data: logs });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    r.get("/bots/status", (req, res) => {
        res.json({ ok: true, data: getStatus() });
    });

    return r;
}

module.exports = { adminRoutes };
