// src/routes/onboarding.js
// Kalkulyator + ro'yxatdan o'tish (public API — auth talab qilinmaydi)
"use strict";
const express  = require("express");
const mongoose = require("mongoose");
const Shop     = require("../models/Shop");
const { WEBAPP_BASE_URL } = require("../config");
const { PLANS, ADDONS, calcMonthlyPrice } = require("../billing/billingService");
const { getSectorList }   = require("../services/shopAI");

// Printer narxlari


function onboardingRoutes() {
    const r = express.Router();

    // ─── TARIF KALKULYATORI ───────────────────────────────────────────────────
    // POST /api/onboarding/calculate
    // { plan, hasPrinter, printerType, months }
    r.post("/calculate", (req, res) => {
        const { plan = "starter", hasPrinter = false, printerType = "none", months = 1 } = req.body;

        if (!PLANS[plan])
            return res.status(400).json({ ok: false, error: `Noto'g'ri tarif: ${plan}. Mavjud: ${Object.keys(PLANS).join(', ')}` });

        const planPrice    = PLAN_PRICES[plan];
        const printerOT    = hasPrinter ? (PRINTER_PRICES[printerType]?.oneTime || 0)  : 0;
        const printerMo    = hasPrinter ? (PRINTER_PRICES[printerType]?.monthly || 0)  : 0;
        const monthlyTotal = planPrice + printerMo;

        const n = Math.max(1, Math.min(12, Number(months) || 1));

        const sectors = getSectorList();
        const { WEBAPP_PRICES, canUseWebApp } = require("../billing/billingService");
        const includeWebApp = req.body.includeWebApp === true;
        const webAppFee = (includeWebApp && canUseWebApp(plan))
            ? (WEBAPP_PRICES[plan] || 0) : 0;

        res.json({ ok: true, data: {
            plan,
            planName:    { starter:"Starter", pro:"Pro", business:"Business" }[plan],
            planPrice,
            hasPrinter,
            printerType,
            printer: {
                oneTime:    printerOT,
                monthly:    printerMo,
                label:      printerType === "bought" ? "Bir martalik sotib olish"
                          : printerType === "rental" ? "Oylik ijara"
                          : "Yo'q",
            },
            webApp: {
                included:   includeWebApp,
                canUse:     canUseWebApp(plan),
                fee:        canUseWebApp(plan) ? (WEBAPP_PRICES[plan] || 0) : null,
                label:      !canUseWebApp(plan)
                    ? "❌ Starter tarifida yo'q"
                    : (WEBAPP_PRICES[plan] === 0 ? "✅ Bepul" : `+${(WEBAPP_PRICES[plan]||0).toLocaleString()} so'm/oy`),
            },
            monthlyTotal: monthlyTotal + webAppFee,
            monthlyWithoutWebApp: monthlyTotal,
            months:     n,
            firstPayment:    printerOT + monthlyTotal,
            recurringPayment: monthlyTotal,
            breakdown: {
                tarif:   planPrice,
                printer: printerMo,
                jami:    monthlyTotal,
            },
            features: {
                starter:  ["Telegram bot","Sotuv+Chiqim","Hisobot","Qarzlar"],
                pro:      ["Telegram bot","Sotuv+Chiqim","Hisobot","Qarzlar","Cashback","AI sotuv","WebApp dashboard"],
                business: ["Telegram bot","Sotuv+Chiqim","Hisobot","Qarzlar","Cashback","AI sotuv","WebApp dashboard","Priority support","Barcha yangiliklar"],
            }[plan],
        }});
    });

    // ─── RO'YXATDAN O'TISH SO'ROVI ───────────────────────────────────────────
    // POST /api/onboarding/register
    // { name, ownerName, phone, address, plan, hasPrinter, printerType, calculatedPrice, notes }
    r.post("/register", async (req, res) => {
        try {
            const {
                name, ownerName, phone, address,
                plan, hasPrinter, printerType, sector,
                calculatedPrice, notes,
            } = req.body;

            // Majburiy tekshiruv
            const missing = [];
            if (!name)      missing.push("Do'kon nomi");
            if (!ownerName) missing.push("Egasi ismi");
            if (!phone)     missing.push("Telefon");
            if (!plan)      missing.push("Tarif");
            if (missing.length)
                return res.status(400).json({ ok: false, error: `Majburiy: ${missing.join(", ")}` });

            // Bir xil telefon bilan boshqa so'rov bormi?
            const exists = await Shop.findOne({ phone: phone.trim() }).lean();
            if (exists)
                return res.status(409).json({
                    ok: false,
                    error: "Bu telefon raqam allaqachon ro'yxatdan o'tgan. Muammo bo'lsa: @botpos_support",
                });

            const _id = new mongoose.Types.ObjectId();

            await Shop.create({
                _id,
                name:      name.trim(),
                ownerName: ownerName.trim(),
                phone:     phone.trim(),
                address:   address?.trim() || "",
                plan:      plan || "starter",
                sector:    sector || "boshqa",
                status:    "pending",
                isActive:  false,
                webappUrl: `${WEBAPP_BASE_URL}?shop=${_id}`,
                billing: {
                    monthlyPrice:        PLAN_PRICES[plan] || PLAN_PRICES.starter,
                    hasPrinter:          !!hasPrinter,
                    printerType:         printerType || "none",
                    printerMonthlyPrice: hasPrinter && printerType === "rental" ? 50_000 : 0,
                },
                onboarding: {
                    submittedAt:     new Date(),
                    selectedPlan:    plan,
                    hasPrinter:      !!hasPrinter,
                    printerType:     printerType || "none",
                    notes:           notes || "",
                    calculatedPrice: Number(calculatedPrice) || 0,
                },
                notes: notes || "",
            });

            // Admin ga ogohlantirish (async)
            notifyAdmin({ name, ownerName, phone, plan, calculatedPrice }).catch(() => {});

            res.status(201).json({ ok: true, data: {
                message: "So'rovingiz qabul qilindi! Admin 24 soat ichida siz bilan bog'lanadi.",
                contact: "@botpos_support",
                nextStep: "Telegram orqali bot tokenlarini yuboring va aktivlashtiring.",
            }});
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── SO'ROV HOLATI TEKSHIRISH ─────────────────────────────────────────────
    // GET /api/onboarding/status?phone=+998...
    r.get("/status", async (req, res) => {
        try {
            const { phone } = req.query;
            if (!phone) return res.status(400).json({ ok: false, error: "phone kerak" });

            const shop = await Shop.findOne({ phone: phone.trim() })
                .select("name status plan billing.status onboarding.submittedAt onboarding.approvedAt webappUrl")
                .lean();

            if (!shop)
                return res.json({ ok: true, data: { found: false } });

            res.json({ ok: true, data: {
                found: true,
                name:    shop.name,
                status:  shop.status,
                plan:    shop.plan,
                billing: shop.billing?.status,
                submittedAt: shop.onboarding?.submittedAt,
                approvedAt:  shop.onboarding?.approvedAt,
                webappUrl:   shop.status === "active" ? shop.webappUrl : null,
                message: {
                    pending:  "So'rovingiz ko'rib chiqilmoqda. Admin 24 soat ichida bog'lanadi.",
                    active:   "Do'koningiz faol! WebApp URL ga o'ting.",
                    blocked:  "Do'koningiz to'lov muammosi sababli bloklangan. @botpos_support ga murojaat qiling.",
                    disabled: "Do'koningiz o'chirilgan. @botpos_support ga murojaat qiling.",
                }[shop.status] || "Noma'lum holat",
            }});
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ─── TARIF NARXLARI (public) ─────────────────────────────────────────────
    // GET /api/onboarding/plans
    // ─── SOHALAR RO'YXATI (public) ──────────────────────────────────────────
    r.get("/sectors", (req, res) => {
        res.json({ ok: true, data: getSectorList() });
    });

    r.get("/plans", (req, res) => {
        res.json({ ok: true, data: {
            plans:  Object.values(PLANS),
            addons: Object.values(ADDONS),
            printer: {
                bought: { price: 700_000, label: "Bir martalik (tavsiya)", note: "Printer sizniki bo'ladi" },
                rental: { price: 50_000,  label: "Oylik ijara",           note: "Oyiga qo'shimcha to'lov" },
            },
        }});
    });

    return r;
}

// Admin ga xabar berish
async function notifyAdmin({ name, ownerName, phone, plan, calculatedPrice }) {
    const { ADMIN_NOTIFICATION_BOT_TOKEN, ADMIN_NOTIFICATION_CHAT_ID, OPENAI_API_KEY } = require("../config");
    if (!ADMIN_NOTIFICATION_BOT_TOKEN || !ADMIN_NOTIFICATION_CHAT_ID) return;
    try {
        const TelegramBot = require("node-telegram-bot-api");
        const bot = new TelegramBot(ADMIN_NOTIFICATION_BOT_TOKEN, { polling: false });
        await bot.sendMessage(ADMIN_NOTIFICATION_CHAT_ID,
            `🆕 <b>Yangi ro'yxat so'rovi!</b>\n\n` +
            `🏪 Do'kon: <b>${name}</b>\n` +
            `👤 Egasi: ${ownerName}\n` +
            `📞 Tel: ${phone}\n` +
            `📦 Tarif: ${plan}\n` +
            `💰 Hisoblangan: ${Number(calculatedPrice).toLocaleString()} so'm/oy\n\n` +
            `✅ Admin panelda tasdiqlash: /api/admin/shops/pending`,
            { parse_mode: "HTML" }
        );
    } catch {}
}

module.exports = { onboardingRoutes };
