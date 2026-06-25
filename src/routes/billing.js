// src/routes/billing.js — Admin billing API
"use strict";
const express = require("express");
const Shop    = require("../models/Shop");
const Payment = require("../models/Payment");
const { adminAuth } = require("../middlewares/adminAuth");
const {
    confirmPayment, setGrace, removeGrace,
    setBlocked, getPaymentHistory,
    getBillingStats, calcMonthlyPrice,
    PLANS, ADDONS, getBillingStatus,
} = require("../billing/billingService");
const AuditLog = require("../models/AuditLog");

function billingRoutes() {
    const r = express.Router();
    r.use(adminAuth);

    // ─── BILLING STATISTIKA ──────────────────────────────────────────────────
    // GET /api/admin/billing/stats
    r.get("/stats", async (req, res) => {
        try {
            const stats = await getBillingStats();
            res.json({ ok: true, data: stats });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── BARCHA DO'KONLAR BILLING HOLATI ────────────────────────────────────
    // GET /api/admin/billing/shops?status=overdue&page=1
    r.get("/shops", async (req, res) => {
        try {
            const { status, page = 1, limit = 20 } = req.query;
            const filter = { isActive: true };
            if (status) filter["billing.status"] = status;

            const [shops, total] = await Promise.all([
                Shop.find(filter)
                    .select("-botToken -customerBotToken")
                    .sort({ "billing.nextPaymentDate": 1 })
                    .skip((+page - 1) * +limit).limit(+limit).lean(),
                Shop.countDocuments(filter),
            ]);

            const result = shops.map(s => ({
                ...s,
                monthlyPrice:    calcMonthlyPrice(s),
                billingStatus:   getBillingStatus(s),
                daysUntilDue: s.billing?.nextPaymentDate
                    ? Math.ceil((new Date(s.billing.nextPaymentDate) - Date.now()) / 86400000)
                    : null,
            }));

            res.json({ ok: true, data: { shops: result, total, page: +page } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── DO'KON BILLING MA'LUMOTI ────────────────────────────────────────────
    // GET /api/admin/billing/shops/:id
    r.get("/shops/:id", async (req, res) => {
        try {
            const shop = await Shop.findById(req.params.id)
                .select("-botToken -customerBotToken").lean();
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            const history = await getPaymentHistory(shop._id, 12);
            const price   = calcMonthlyPrice(shop);

            res.json({ ok: true, data: {
                shop,
                monthlyPrice: price,
                billingStatus: getBillingStatus(shop),
                paymentHistory: history,
                daysUntilDue: shop.billing?.nextPaymentDate
                    ? Math.ceil((new Date(shop.billing.nextPaymentDate) - Date.now()) / 86400000)
                    : null,
            }});
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── DO'KON BILLING SOZLAMALARINI O'ZGARTIRISH ──────────────────────────
    // PUT /api/admin/billing/shops/:id/settings
    r.put("/shops/:id/settings", async (req, res) => {
        try {
            const { plan, hasPrinter, printerType, printerMonthlyPrice } = req.body;
            const update = {};
            if (plan && ["starter","pro","business"].includes(plan)) {
                update.plan = plan;
                update["billing.monthlyPrice"] = PLANS[plan]?.price;
            }
            if (hasPrinter !== undefined) update["billing.hasPrinter"] = hasPrinter;
            if (printerType) update["billing.printerType"] = printerType;
            if (printerMonthlyPrice !== undefined)
                update["billing.printerMonthlyPrice"] = +printerMonthlyPrice;

            const shop = await Shop.findByIdAndUpdate(req.params.id, update, { new: true })
                .select("-botToken -customerBotToken").lean();
            if (!shop) return res.status(404).json({ ok: false, error: "Topilmadi" });

            res.json({ ok: true, data: { shop, monthlyPrice: calcMonthlyPrice(shop) } });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── TO'LOV QABUL QILISH ─────────────────────────────────────────────────
    // POST /api/admin/billing/shops/:id/pay
    r.post("/shops/:id/pay", async (req, res) => {
        try {
            const { amount, period, description, isPartial } = req.body;
            if (!amount || amount < 1)
                return res.status(400).json({ ok: false, error: "amount kerak" });

            const result = await confirmPayment({
                shopId:      req.params.id,
                amount:      +amount,
                period,
                description,
                receivedBy:  req.adminEmail,
                isPartial:   !!isPartial,
            });

            await AuditLog.create({
                adminEmail: req.adminEmail,
                action: "billing.payment",
                shopId: req.params.id,
                details: { amount, period, isPartial },
                ip: req.ip,
            });

            res.json({ ok: true, data: result });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── GRACE BERISH (qarzga ishlashga ruxsat) ──────────────────────────────
    // POST /api/admin/billing/shops/:id/grace
    r.post("/shops/:id/grace", async (req, res) => {
        try {
            const { note } = req.body;
            await setGrace(req.params.id, note, req.adminEmail);
            await AuditLog.create({
                adminEmail: req.adminEmail, action: "billing.grace",
                shopId: req.params.id, details: { note }, ip: req.ip,
            });
            res.json({ ok: true, message: "Grace berildi — do'kon ishlashda davom etadi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── GRACE BEKOR QILISH ───────────────────────────────────────────────────
    // DELETE /api/admin/billing/shops/:id/grace
    r.delete("/shops/:id/grace", async (req, res) => {
        try {
            await removeGrace(req.params.id);
            res.json({ ok: true, message: "Grace bekor qilindi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── QO'LDA BLOKLASH ─────────────────────────────────────────────────────
    // POST /api/admin/billing/shops/:id/block
    r.post("/shops/:id/block", async (req, res) => {
        try {
            await setBlocked(req.params.id);
            await AuditLog.create({
                adminEmail: req.adminEmail, action: "billing.block",
                shopId: req.params.id, ip: req.ip,
            });
            res.json({ ok: true, message: "Do'kon bloklandi" });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── TO'LOV TARIXI ───────────────────────────────────────────────────────
    // GET /api/admin/billing/shops/:id/history
    r.get("/shops/:id/history", async (req, res) => {
        try {
            const history = await getPaymentHistory(req.params.id, 24);
            res.json({ ok: true, data: history });
        } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
    });

    // ─── TARIF NARXLARI ──────────────────────────────────────────────────────
    // GET /api/admin/billing/plans
    r.get("/plans", (req, res) => {
        const { PLANS, ADDONS } = require("../billing/billingService");
        res.json({ ok: true, data: {
            plans:  Object.values(PLANS),
            addons: Object.values(ADDONS),
            printer: {
                bought: { oneTime: 700_000, label: "Bir martalik sotib olish" },
                rental: { monthly: 50_000,  label: "Oylik ijara" },
            },
        }});
    });

    return r;
}

module.exports = { billingRoutes };
