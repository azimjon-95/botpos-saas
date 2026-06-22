require("dotenv").config();

module.exports = {
    MONGO_URI:             process.env.MONGO_URI || "mongodb://localhost:27017/botpos_saas",
    REDIS_URL:             process.env.REDIS_URL || "redis://localhost:6379",
    MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY || "",
    PORT:                  Number(process.env.PORT) || 6060,
    ADMIN_PANEL_PORT:      Number(process.env.ADMIN_PANEL_PORT) || 7070,
    ADMIN_JWT_SECRET:      process.env.ADMIN_JWT_SECRET || "change_me_32chars_minimum",
    ADMIN_EMAIL:           process.env.ADMIN_EMAIL || "admin@botpos.uz",
    ADMIN_PASSWORD_HASH:   process.env.ADMIN_PASSWORD_HASH || "",
    TZ:                    process.env.TZ || "Asia/Tashkent",
    WEBAPP_BASE_URL:       process.env.WEBAPP_BASE_URL || "https://botpos.uz",
    AUTH_TTL_SECONDS:      60 * 60 * 24 * 2,
    API_RATE_LIMIT:        Number(process.env.API_RATE_LIMIT) || 100,
};
