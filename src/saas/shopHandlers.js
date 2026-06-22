// src/saas/shopHandlers.js — Har bir do'kon boti uchun handler'lar
// Mavjud bot.js logikasi shu yerga context bilan ko'chiriladi
const Redis = require("ioredis");
const { REDIS_URL, AUTH_TTL_SECONDS } = require("../config");
const Worker   = require("../models/Worker");
const Debt     = require("../models/Debt");
const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Counter  = require("../models/Counter");
const { formatMoney } = require("../utils/money");

// ─── Redis (bitta ulash — barcha do'konlar uchun umumiy) ───
let _redis = null;
function getRedis() {
    if (!_redis) {
        _redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 2,
            retryStrategy: t => Math.min(t * 500, 5000),
        });
        _redis.on("error", e => console.error("[redis]", e.message));
    }
    return _redis;
}

// ─── Auth key lar ───────────────────────────────────────────
function authKey(shopId, userId)  { return `auth:${shopId}:${userId}`; }
function modeKey(shopId, userId)  { return `mode:${shopId}:${userId}`; }

async function isAuthed(shopId, userId) {
    try { return (await getRedis().get(authKey(shopId, userId))) === "1"; }
    catch { return false; }
}
async function setAuthed(shopId, userId, ttl) {
    try { await getRedis().set(authKey(shopId, userId), "1", "EX", ttl || AUTH_TTL_SECONDS); }
    catch {}
}
async function setMode(shopId, userId, mode) {
    try { await getRedis().set(modeKey(shopId, userId), mode, "EX", AUTH_TTL_SECONDS); }
    catch {}
}
async function getMode(shopId, userId) {
    try { return (await getRedis().get(modeKey(shopId, userId))) || null; }
    catch { return null; }
}

// ─── Parol tekshirish ───────────────────────────────────────
async function checkPassword(shopId, userId, text, botPassword) {
    const worker = await Worker.findOne({ shopId, tgId: userId, isActive: true }).lean();
    if (worker) return true;
    return String(text || "").trim() === String(botPassword || "1234").trim();
}

// ─── Balans ─────────────────────────────────────────────────
async function getBalance(shopId) {
    const doc = await Counter.findOne({ shopId, key: "balance" });
    return Number(doc?.value || 0);
}
async function addBalance(shopId, delta, session) {
    const opts = { new: true, upsert: true };
    if (session) opts.session = session;
    const doc = await Counter.findOneAndUpdate(
        { shopId, key: "balance" },
        { $inc: { value: delta } },
        opts
    );
    return doc.value;
}

// ─── Asosiy menyu ───────────────────────────────────────────
function mainMenu() {
    return {
        keyboard: [
            [{ text: "🧁 Sotish" }, { text: "💸 Chiqim" }],
            [{ text: "📌 Qarzlar" }, { text: "🔒 Kassani yopish" }],
            [{ text: "📆 Oylik hisobot" }, { text: "📋 Menyu" }],
        ],
        resize_keyboard: true,
    };
}

// ─── Handler larni ulash ────────────────────────────────────
function attachHandlers(bot, ctx) {
    const { shopId, groupChatId, webappUrl, adminTgId, botPassword } = ctx;

    // ── /start ──
    bot.onText(/\/start/, async (msg) => {
        const userId = msg.from?.id;
        const chatId = msg.chat.id;
        if (!userId) return;

        const authed = await isAuthed(shopId, userId);
        if (authed) {
            return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainMenu() });
        }

        return bot.sendMessage(chatId,
            "🔒 Xush kelibsiz!\n\nDavom etish uchun parolni kiriting:",
            { reply_markup: { remove_keyboard: true } }
        );
    });

    // ── Xabarlar ──
    bot.on("message", async (msg) => {
        const chatId  = msg.chat.id;
        const userId  = msg.from?.id;
        const text    = String(msg.text || "").trim();
        if (!userId || !text) return;

        const authed = await isAuthed(shopId, userId);

        // ── Parol ──
        if (!authed) {
            const ok = await checkPassword(shopId, userId, text, botPassword);
            if (ok) {
                await setAuthed(shopId, userId);
                return bot.sendMessage(chatId, "✅ Kirish muvaffaqiyatli!", { reply_markup: mainMenu() });
            } else {
                return bot.sendMessage(chatId, "❌ Noto'g'ri parol. Qayta urinib ko'ring.");
            }
        }

        // ── Menyu ──
        if (text === "📋 Menyu") {
            const btns = webappUrl
                ? { inline_keyboard: [[{ text: "📊 Dashboard", web_app: { url: webappUrl + "?shop=" + shopId } }]] }
                : null;
            await bot.sendMessage(chatId, "📋 Qo'shimcha:", { reply_markup: mainMenu() });
            if (btns) await bot.sendMessage(chatId, "📱 WebApp:", { reply_markup: btns });
            return;
        }

        if (text === "📌 Qarzlar") {
            const debts = await Debt.find({ shopId, isClosed: false }).sort({ createdAt: -1 }).limit(20).lean();
            if (!debts.length) return bot.sendMessage(chatId, "✅ Ochiq qarzlar yo'q.");
            await bot.sendMessage(chatId, `📌 Ochiq qarzlar: ${debts.length} ta`);
            for (const d of debts) {
                await bot.sendMessage(chatId,
                    `📌 Qarz: <b>${formatMoney(d.remainingDebt)}</b> so'm\n` +
                    `Tel: ${d.customerPhone || "—"}\nIzoh: ${d.note || "—"}`,
                    { parse_mode: "HTML" }
                );
            }
            return;
        }

        if (text === "🔒 Kassani yopish") {
            const { closeCash } = require("../services/closeCash");
            const summary = await closeCash(shopId);
            return bot.sendMessage(chatId,
                `📊 Kassa yopildi:\n💰 Tushum: ${formatMoney(summary.saleSum)}\n💸 Chiqim: ${formatMoney(summary.expenseSum)}\n🏦 Balans: ${formatMoney(summary.balance)}`,
                { parse_mode: "HTML" }
            );
        }

        // ── Sotuv (default) ──
        if (text === "🧁 Sotish") {
            await setMode(shopId, userId, "sale");
            return bot.sendMessage(chatId, "Sotuvni yozing:\nMasalan: Tort 140000, Pepsi 17000");
        }

        const mode = await getMode(shopId, userId);
        if (mode === "sale" || !mode) {
            // Sodda sotuv parser
            const { parseSaleText } = require("../services/saleParser");
            const items = parseSaleText(text);
            if (items && items.length > 0) {
                const { saveSale } = require("../services/saleService");
                const seller = { tgId: userId, tgName: msg.from?.first_name || "Sotuvchi" };
                const result = await saveSale({ shopId, seller, items });
                const msg2 = `✅ Sotuv:\n💰 ${formatMoney(result.paidTotal)} so'm\n${result.debtTotal > 0 ? `📌 Qarz: ${formatMoney(result.debtTotal)} so'm` : ""}`;
                await bot.sendMessage(chatId, msg2, { parse_mode: "HTML" });
                if (groupChatId) await bot.sendMessage(groupChatId, msg2, { parse_mode: "HTML" }).catch(() => {});
                return;
            }
            return bot.sendMessage(chatId, "❓ Noto'g'ri format. Masalan: Tort 140000");
        }
    });

    console.log(`[shopHandlers] Handler ulandi: shopId=${shopId}`);
}

module.exports = { attachHandlers, getBalance, addBalance };
