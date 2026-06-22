// src/routes/webapp.js — WebApp API (shopId bilan izolyatsiya)
const express = require("express");
const { shopGuard }      = require("../middlewares/shopGuard");
const { verifyTgWebApp } = require("../middlewares/verifyTgWebApp");
const { getSummary, getActivity, getChart } = require("../services/dashboard");

function webappRoutes() {
    const r = express.Router();

    // Barcha so'rovlarda: shopId tekshirish → TG auth
    r.use(shopGuard);
    r.use(verifyTgWebApp);

    // ── GET /api/webapp/dashboard/summary?from=ISO&to=ISO
    r.get("/dashboard/summary", async (req, res) => {
        try {
            const data = await getSummary(req.shopId, req.query.from, req.query.to);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── GET /api/webapp/dashboard/activity?from=ISO&to=ISO&categoryKey=...
    r.get("/dashboard/activity", async (req, res) => {
        try {
            const data = await getActivity(req.shopId, req.query.from, req.query.to, req.query.categoryKey);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── GET /api/webapp/dashboard/chart?from=ISO
    r.get("/dashboard/chart", async (req, res) => {
        try {
            const data = await getChart(req.shopId, req.query.from);
            res.json({ ok: true, data });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    return r;
}

module.exports = { webappRoutes };
