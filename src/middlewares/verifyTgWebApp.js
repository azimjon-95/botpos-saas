const crypto = require("crypto");
const { decrypt } = require("../utils/encrypt");

function verifyTgWebApp(req, res, next) {
    const initData = req.headers["x-telegram-init-data"];
    const shop = req.shop;
    if (!shop || !shop.botToken) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    try {
        const botToken = decrypt(shop.botToken);
        if (!initData) {
            // localhost da tekshiruvsiz o'tkazamiz
            const host = req.hostname;
            if (host === "localhost" || host === "127.0.0.1") { req.tgUser = null; return next(); }
            return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
        }

        const params = new URLSearchParams(initData);
        const hash   = params.get("hash");
        params.delete("hash");
        const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
        const dataStr = sorted.map(([k, v]) => `${k}=${v}`).join("\n");

        const secret  = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
        const calcHash = crypto.createHmac("sha256", secret).update(dataStr).digest("hex");

        if (calcHash !== hash) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

        const userRaw = params.get("user");
        req.tgUser = userRaw ? JSON.parse(userRaw) : null;
        next();
    } catch (e) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
}

module.exports = { verifyTgWebApp };
