require("dotenv").config();

// Production da majburiy o'zgaruvchilar
const required = ["MASTER_ENCRYPTION_KEY", "ADMIN_JWT_SECRET"];
for (const key of required) {
    if (!process.env[key]) {
        console.error(`❌ .env da "${key}" yo'q! Dastur to'xtatildi.`);
        process.exit(1);
    }
}

module.exports = {
    MONGO_URI:             process.env.MONGO_URI             || "mongodb://localhost:27017/botpos_saas",
    REDIS_URL:             process.env.REDIS_URL             || "redis://localhost:6379",
    MASTER_ENCRYPTION_KEY: process.env.MASTER_ENCRYPTION_KEY,   // null check yuqorida
    PORT:                  Number(process.env.PORT)          || 6060,
    ADMIN_JWT_SECRET:      process.env.ADMIN_JWT_SECRET,         // null check yuqorida
    ADMIN_EMAIL:           process.env.ADMIN_EMAIL           || "admin@botpos.uz",
    TZ:                    process.env.TZ                    || "Asia/Tashkent",
    WEBAPP_BASE_URL:       process.env.WEBAPP_BASE_URL       || "https://botpos.uz",
    AUTH_TTL_SECONDS:      60 * 60 * 24 * 2,   // 2 kun
    API_RATE_LIMIT:        Number(process.env.API_RATE_LIMIT) || 100,
    BOT_RATE_LIMIT:        Number(process.env.BOT_RATE_LIMIT) || 30,
};
