// src/saas/shopHandlers.js
// FIXES:
//   #1 — Chiqim handler qo'shildi
//   #2 — Oylik hisobot handler qo'shildi
//   #3 — WebApp URL ikki marta ?shop= xatosi tuzatildi
//   #4 — callback_query handler qo'shildi (qarz to'lash)
//   #5 — AI sotuv (OpenAI + voice) qo'shildi
const { mongoose } = require("../db");
const Product = require("../models/Product");
const { getCatalog, addProduct } = require("../services/catalogCache");
const { handleCatalogCallback, handleCatalogText, sendCatalogMenu } = require("./catalogBot");
const { REDIS_URL, AUTH_TTL_SECONDS, OWNER_AUTH_TTL } = require("../config");

// Redis — ixtiyoriy (bot ishlaganda kerak)
let Redis = null;
try { Redis = require("ioredis"); } catch {}
const Worker   = require("../models/Worker");
const Debt     = require("../models/Debt");
const Sale     = require("../models/Sale");
const Expense  = require("../models/Expense");
const Counter  = require("../models/Counter");
const { formatMoney } = require("../utils/money");
const { checkShopBilling, calcMonthlyPrice } = require("../billing/billingService");
// decrypt olib tashlandi — openaiKey endi markaziy

// ─── EXPENSE KATEGORIYALAR ───────────────────────────────────────────────────
const EXPENSE_CATEGORIES = [
    { key:"rent",        emoji:"🏠", label:"Arenda" },
    { key:"electricity", emoji:"⚡", label:"Elektr" },
    { key:"supplier",    emoji:"🏷",  label:"Firma/Taminot" },
    { key:"worker",      emoji:"👷", label:"Ishchi haqi" },
    { key:"food",        emoji:"🍽",  label:"Ovqat/Non" },
    { key:"taxi",        emoji:"🚕", label:"Taksi/Yo'l" },
    { key:"repair",      emoji:"🛠",  label:"Usta/Ta'mir" },
    { key:"bank",        emoji:"🏦", label:"Bank/Soliq" },
    { key:"cash",        emoji:"💰", label:"Kapilka/Kassa" },
    { key:"other",       emoji:"🧾", label:"Boshqa" },
];
const CAT_MAP = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.key, c]));

// ─── REDIS ───────────────────────────────────────────────────────────────────
let _redis = null;
let _redisOk   = true;
let _lastRetry = 0;

function getRedis() {
    if (!Redis || !REDIS_URL) return null;
    // Xato bergan bo'lsa 30s kutamiz
    if (!_redisOk && Date.now() - _lastRetry < 30_000) return null;
    if (!_redis) {
        _redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 0,
            retryStrategy:        () => null,
            lazyConnect:          true,
            enableOfflineQueue:   false,
            connectTimeout:       1500,
        });
        _redis.on("error", () => {
            _redisOk   = false;
            _lastRetry = Date.now();
        });
        _redis.on("connect", () => { _redisOk = true; });
        _redis.on("close",   () => { _redisOk = false; });
    }
    return _redisOk ? _redis : null;
}

function authKey(shopId, userId)      { return `auth:${shopId}:${userId}`; }
function ownerAuthKey(shopId, userId)  { return `owner_auth:${shopId}:${userId}`; } // Egasi (3 kun)
function modeKey(shopId, userId)       { return `mode:${shopId}:${userId}`; }
function draftKey(shopId, userId)      { return `draft:${shopId}:${userId}`; }
function cartKey(shopId, userId)       { return `cart:${shopId}:${userId}`; }

async function isAuthed(shopId, userId) {
    try { const r = getRedis(); return r ? (await r.get(authKey(shopId, userId))) === "1" : false; }
    catch { return false; }
}
async function setAuthed(shopId, userId) {
    try { const r = getRedis(); if(r) await r.set(authKey(shopId, userId), "1", "EX", AUTH_TTL_SECONDS); }
    catch {}
}
async function setMode(shopId, userId, mode) {
    try { const r = getRedis(); if(r) await r.set(modeKey(shopId, userId), mode, "EX", AUTH_TTL_SECONDS); }
    catch {}
}
async function getMode(shopId, userId) {
    try { const r = getRedis(); return r ? (await r.get(modeKey(shopId, userId))) || null : null; }
    catch { return null; }
}
async function saveDraft(shopId, userId, data) {
    try { const r = getRedis(); if(r) await r.set(draftKey(shopId, userId), JSON.stringify(data), "EX", 600); }
    catch {}
}
async function getDraft(shopId, userId) {
    try {
        const r = getRedis(); if(!r) return null;
        const raw = await r.get(draftKey(shopId, userId));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}
async function clearDraft(shopId, userId) {
    try { const r = getRedis(); if(r) await r.del(draftKey(shopId, userId)); }
    catch {}
}


// ─── SAVAT (CART) ────────────────────────────────────────────────────────────
async function getCart(shopId, userId) {
    try {
        const r = getRedis();
        if (!r) return [];
        const raw = await r.get(cartKey(shopId, userId));
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}
async function addToCart(shopId, userId, item) {
    try {
        const r = getRedis();
        if (!r) return;
        const cart = await getCart(shopId, userId);
        const ex = cart.find(c => c.name === item.name);
        if (ex) { ex.qty += 1; ex.paid = ex.qty * ex.price; }
        else cart.push({ name: item.name, qty: 1, price: item.price, paid: item.price });
        await r.set(cartKey(shopId, userId), JSON.stringify(cart), "EX", 3600);
        return cart;
    } catch { return []; }
}
async function clearCart(shopId, userId) {
    try { const r = getRedis(); if(r) await r.del(cartKey(shopId, userId)); } catch {}
}
function cartSummary(cart) {
    const total = cart.reduce((a, c) => a + c.paid, 0);
    const lines = cart.map(c => `• ${c.name} x${c.qty} = ${formatMoney(c.paid)}`).join("\n");
    return { total, lines };
}


// ─── PAROL TEKSHIRISH ────────────────────────────────────────────────────────
async function checkPassword(shopId, userId, text, botPassword, adminTgId) {
    // Do'kon egasi — parol tekshiruvi (3 kunda bir)
    if (adminTgId && userId === adminTgId) {
        return String(text || "").trim() === String(botPassword || "1234").trim();
    }
    // Xodim — parol tekshiruvi
    const worker = await Worker.findOne({ shopId, tgId: userId, isActive: true }).lean();
    if (worker) return true;
    return String(text || "").trim() === String(botPassword || "1234").trim();
}

// Foydalanuvchi bot ga kirishi mumkinmi?
// Faqat do'kon egasi va xodimlar kirishi mumkin
async function canAccessBot(shopId, userId, adminTgId) {
    // Egasi har doim kira oladi
    if (adminTgId && userId === adminTgId) return true;
    // Xodimmi?
    const worker = await Worker.findOne({ shopId, tgId: userId, isActive: true }).lean();
    return !!worker;
}

// ─── BALANS (atomik $inc — race condition yo'q) ──────────────────────────────
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
async function getBalance(shopId) {
    const doc = await Counter.findOne({ shopId, key: "balance" });
    return Number(doc?.value || 0);
}

// ─── ORDER NO (shopId bilan — har do'kon o'z raqami) ────────────────────────
async function nextOrderNo(shopId, session) {
    const opts = { new: true, upsert: true };
    if (session) opts.session = session;
    const doc = await Counter.findOneAndUpdate(
        { shopId, key: "orderNo" },
        { $inc: { value: 1 } },
        opts
    );
    return `#${String(doc.value).padStart(4, "0")}`;
}

// ─── SOTUV PARSER ────────────────────────────────────────────────────────────
// Format: "Tort 140000" | "Tort x2 140000 berdi 100000" | "Tort 140000, Pepsi 17000"
function parseSaleText(text) {
    if (!text) return null;
    const items = [];
    for (const part of text.split(/[,\n]/)) {
        const p = part.trim();
        if (!p) continue;
        const nums = p.match(/\d[\d\s]*/g);
        if (!nums) continue;
        const price = parseInt(nums[nums.length - 1].replace(/\s/g, ""), 10);
        if (!price || price < 100) continue;
        const qty  = nums.length > 1 ? parseInt(nums[0], 10) || 1 : 1;
        const name = p.replace(/\d[\d\s]*/g, "").replace(/[xX]/g, "").trim() || "Mahsulot";
        // "berdi" so'zi: berdi <summa>
        let paid = null;
        const berdiMatch = p.match(/berdi\s+(\d[\d\s]*)/i);
        if (berdiMatch) paid = parseInt(berdiMatch[1].replace(/\s/g, ""), 10);
        items.push({ name, qty, price, paid: paid !== null ? paid : qty * price });
    }
    return items.length > 0 ? items : null;
}

// ─── SOTUV SAQLASH (transaction) ─────────────────────────────────────────────
async function saveSale({ shopId, seller, items, phone }) {
    const session = await mongoose.startSession();
    let result;
    try {
        session.startTransaction();
        let total = 0, paidTotal = 0;
        for (const it of items) {
            const line = (it.qty || 1) * (it.price || 0);
            total     += line;
            paidTotal += (it.paid ?? line);
        }
        paidTotal = Math.min(paidTotal, total);
        const debtTotal = Math.max(0, total - paidTotal);
        const orderNo   = await nextOrderNo(shopId, session);

        const [sale] = await Sale.create([{
            shopId, orderNo, seller,
            phone: phone || null, items, total, paidTotal, debtTotal,
        }], { session });

        await Counter.findOneAndUpdate(
            { shopId, key: "balance" },
            { $inc: { value: paidTotal } },
            { new: true, upsert: true, session }
        );

        if (debtTotal > 0) {
            await Debt.create([{
                shopId, saleId: sale._id,
                customerPhone: phone || null,
                totalDebt: debtTotal, remainingDebt: debtTotal, seller,
            }], { session });
        }
        await session.commitTransaction();
        result = { paidTotal, debtTotal, orderNo, total, saleId: sale._id };
    } catch (e) {
        await session.abortTransaction();
        throw e;
    } finally {
        session.endSession();
    }
    return result;
}

// ─── CHIQIM SAQLASH (transaction) ────────────────────────────────────────────
async function saveExpense({ shopId, spender, title, amount, categoryKey, description }) {
    const session = await mongoose.startSession();
    try {
        session.startTransaction();
        const balance = await getBalance(shopId);
        if (balance < amount) throw new Error(`Balans yetarli emas (${formatMoney(balance)} so'm)`);
        const orderNo = await nextOrderNo(shopId, session);
        await Expense.create([{
            shopId, orderNo, spender,
            title, amount,
            categoryKey: categoryKey || "other",
            description: description || "",
        }], { session });
        await Counter.findOneAndUpdate(
            { shopId, key: "balance" },
            { $inc: { value: -amount } },
            { new: true, upsert: true, session }
        );
        await session.commitTransaction();
        return { orderNo, amount, categoryKey };
    } catch (e) {
        await session.abortTransaction();
        throw e;
    } finally {
        session.endSession();
    }
}

// ─── AI SOTUV PARSE (OpenAI) ─────────────────────────────────────────────────
async function aiParseSale(text, openaiKey) {
    if (!openaiKey) return null;
    try {
        const key = decrypt(openaiKey);
        if (!key) return null;
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                temperature: 0,
                max_tokens: 150,
                messages: [{
                    role: "system",
                    content: `Siz sotuv xabarini parse qiladigan yordamchisiz.
Foydalanuvchi xabarini quyidagi formatga o'tkaz:
"Mahsulot Nta NARX berdi SUM tel RAQAM"
Misol kirish: "ikkita tort yetmish ming, pepsi on yetti"
Misol chiqish: "Tort 2ta 70000, Pepsi 1ta 17000"
Faqat o'zbek tilida javob ber. Hech qanday izoh qo'shma.`,
                }, {
                    role: "user",
                    content: text,
                }],
            }),
        });
        const data = await resp.json();
        const normalized = data?.choices?.[0]?.message?.content?.trim();
        if (!normalized) return null;
        return parseSaleText(normalized);
    } catch (e) {
        console.error("[aiParseSale]", e.message);
        return null;
    }
}

// ─── AI CHIQIM PARSE ─────────────────────────────────────────────────────────
async function aiParseExpense(text, openaiKey) {
    if (!openaiKey) return null;
    try {
        const key = decrypt(openaiKey);
        if (!key) return null;
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                temperature: 0,
                max_tokens: 100,
                messages: [{
                    role: "system",
                    content: `Chiqim xabarini JSON ga o'tkazasiz.
Kategoriyalar: rent, electricity, supplier, worker, food, taxi, repair, bank, cash, other
FORMAT: {"categoryKey":"...","amount":NUMBER,"description":"..."}
FAQAT JSON qaytaring. Hech qanday matn qo'shmang.`,
                }, {
                    role: "user",
                    content: text,
                }],
            }),
        });
        const data = await resp.json();
        const raw = data?.choices?.[0]?.message?.content?.trim();
        if (!raw) return null;
        return JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch (e) {
        console.error("[aiParseExpense]", e.message);
        return null;
    }
}


// ─── MENYU ───────────────────────────────────────────────────────────────────
function mainMenu(hasWebApp = false) {
    const rows = [
        [{ text: "🧁 Sotish" }, { text: "💸 Chiqim" }],
        [{ text: "📌 Qarzlar" }, { text: "🔒 Kassani yopish" }],
        [{ text: "📅 Bugun" }, { text: "📆 Hafta" }, { text: "📊 Oy" }],
        [{ text: "📋 Menyu" }],
    ];
    if (hasWebApp) rows.push([{ text: "🌐 Mening saytim" }, { text: "🚚 Yetkazib berish" }]);
    if (hasWebApp) rows.push([{ text: "💳 Cashback" }]);
    return { keyboard: rows, resize_keyboard: true };
}

function expenseCategoryKeyboard() {
    const rows = [];
    for (let i = 0; i < EXPENSE_CATEGORIES.length; i += 2) {
        const row = [EXPENSE_CATEGORIES[i], EXPENSE_CATEGORIES[i + 1]].filter(Boolean);
        rows.push(row.map(c => ({ text: `${c.emoji} ${c.label}` })));
    }
    rows.push([{ text: "❌ Bekor qilish" }]);
    return { keyboard: rows, resize_keyboard: true, one_time_keyboard: true };
}

function debtKeyboard(debtId) {
    return {
        inline_keyboard: [[
            { text: "✅ To'liq to'lash", callback_data: `debt_full:${debtId}` },
            { text: "💳 Qisman to'lash", callback_data: `debt_part:${debtId}` },
        ]],
    };
}

// ─── UNIVERSAL HISOBOT ───────────────────────────────────────────────────────
// period: "today" | "week" | "month"
async function generateReport(shopId, period = "today") {
    const dayjs  = require("dayjs");
    const utc    = require("dayjs/plugin/utc");
    const tz     = require("dayjs/plugin/timezone");
    dayjs.extend(utc); dayjs.extend(tz);
    const TZ  = "Asia/Tashkent";
    const now = dayjs().tz(TZ);

    let from, to, label, emoji;
    switch (period) {
        case "today":
            from  = now.startOf("day").toDate();
            to    = now.endOf("day").toDate();
            label = `📅 <b>Bugungi hisobot</b> (${now.format("DD.MM.YYYY")})`;
            emoji = "📅";
            break;
        case "week":
            from  = now.startOf("week").toDate();
            to    = now.endOf("week").toDate();
            label = `📆 <b>Haftalik hisobot</b> (${now.startOf("week").format("DD.MM")}–${now.endOf("week").format("DD.MM.YYYY")})`;
            emoji = "📆";
            break;
        default: // month
            from  = now.startOf("month").toDate();
            to    = now.endOf("month").toDate();
            label = `📊 <b>${now.format("MMMM YYYY")} oylik hisobot</b>`;
            emoji = "📊";
    }

    const match = { shopId, createdAt: { $gte: from, $lte: to } };

    const [sales, expenses, debts, balance] = await Promise.all([
        Sale.find(match).lean(),
        Expense.find(match).lean(),
        Debt.find({ shopId, isClosed: false }).lean(),
        getBalance(shopId),
    ]);

    const saleSum    = sales.reduce((a, s) => a + (s.paidTotal || 0), 0);
    const debtSum    = sales.reduce((a, s) => a + (s.debtTotal || 0), 0);
    const expenseSum = expenses.reduce((a, e) => a + (e.amount || 0), 0);
    const openDebt   = debts.reduce((a, d) => a + (d.remainingDebt || 0), 0);
    const foyda      = saleSum - expenseSum;

    // [5] TOP-5 mahsulot
    const productCount = {};
    for (const s of sales) {
        for (const it of (s.items || [])) {
            const k = it.name || "Noma'lum";
            productCount[k] = (productCount[k] || 0) + (it.qty || 1);
        }
    }
    const top5 = Object.entries(productCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // [6] Xodimlar bo'yicha
    const workerStats = {};
    for (const s of sales) {
        const name = s.seller?.tgName || "Noma'lum";
        if (!workerStats[name]) workerStats[name] = { count: 0, sum: 0 };
        workerStats[name].count++;
        workerStats[name].sum += s.paidTotal || 0;
    }
    const workers = Object.entries(workerStats)
        .sort((a, b) => b[1].sum - a[1].sum);

    const lines = [
        label, "",
        `💰 Tushum: <b>${formatMoney(saleSum)}</b> so'm`,
        debtSum > 0 ? `📌 Nasiya: <b>${formatMoney(debtSum)}</b> so'm` : "",
        `💸 Chiqim: <b>${formatMoney(expenseSum)}</b> so'm`,
        `📉 Foyda: <b>${foyda >= 0 ? "" : "-"}${formatMoney(Math.abs(foyda))}</b> so'm`,
        "",
        `🏦 Balans: <b>${formatMoney(balance)}</b> so'm`,
        openDebt > 0 ? `⚠️ Ochiq qarzlar: <b>${formatMoney(openDebt)}</b> so'm` : "✅ Qarz yo'q",
        "",
        `📊 Sotuvlar: <b>${sales.length} ta</b>`,
        `🧾 Chiqimlar: <b>${expenses.length} ta</b>`,
    ].filter(l => l !== "");

    // TOP mahsulotlar
    if (top5.length) {
        lines.push("", "🏆 <b>Eng ko'p sotilgan:</b>");
        top5.forEach(([name, qty], i) => {
            lines.push(`  ${i + 1}. ${name} — ${qty} ta`);
        });
    }

    // Xodimlar
    if (workers.length > 1) {
        lines.push("", "👷 <b>Xodimlar bo'yicha:</b>");
        workers.forEach(([name, s]) => {
            lines.push(`  👤 ${name}: ${s.count} ta sotuv — ${formatMoney(s.sum)} so'm`);
        });
    }

    return lines.join("\n");
}

// Eski nom bilan mos (backward compat)
async function monthlyReport(shopId) {
    return generateReport(shopId, "month");
}

// ─── HANDLER ULASH ───────────────────────────────────────────────────────────
function attachHandlers(bot, ctx) {
    const { shopId, groupChatId, adminTgId, botPassword } = ctx;
    const sector    = ctx.shop?.sector   || "boshqa";
    const hasWebApp = !!ctx.shop?.webApp?.enabled;

    // Suhbat tarixi (Redis, 10 xabar)
    const histKey = (uid) => `hist:${shopId}:${uid}`;
    async function getHistory(uid) {
        try { const r = getRedis(); if(!r) return []; const raw = await r.get(histKey(uid)); return raw ? JSON.parse(raw) : []; } catch { return []; }
    }
    async function addHistory(uid, role, content) {
        try {
            const r = getRedis(); if(!r) return;
            const h = await getHistory(uid);
            h.push({ role, content });
            if (h.length > 10) h.splice(0, h.length - 10);
            await r.set(histKey(uid), JSON.stringify(h), "EX", 3600);
        } catch {}
    }
    // FIX #3: webappUrl dan ?shop= olib tashlandi — u allaqachon URL da bor
    const webappUrl = ctx.webappUrl?.replace(/\?shop=.*$/, "");
    // openaiKey endi markaziy — config.js da OPENAI_API_KEY

    // ── /start ──────────────────────────────────────────────────────────────
    // /backup — qo'lda backup (faqat admin)
    bot.onText(/\/backup/, async (msg) => {
        const uid    = msg.from?.id;
        const chatId = msg.chat.id;
        if (!uid) return;
        if (!(await isAuthed(shopId, uid))) return;
        if (adminTgId && uid !== adminTgId) {
            return bot.sendMessage(chatId, "❌ Faqat admin backup qila oladi.");
        }
        await bot.sendMessage(chatId, "⏳ Backup tayyorlanmoqda...");
        const { manualBackup } = require("../services/backupScheduler");
        const r = await manualBackup(shopId);
        if (r?.ok) {
            await bot.sendMessage(chatId, `✅ Backup yuborildi: ${r.fileName}`);
        } else {
            await bot.sendMessage(chatId, `❌ Backup xato: ${r?.reason || "noma'lum"}`);
        }
    });

    bot.onText(/\/start/, async (msg) => {
        const userId = msg.from?.id;
        const chatId = msg.chat.id;
        if (!userId) return;

        // Faqat do'kon egasi va xodimlar kirishi mumkin
        const canAccess = await canAccessBot(shopId, userId, adminTgId);
        if (!canAccess) {
            return bot.sendMessage(chatId,
                "⛔ Kechirasiz, bu bot faqat do'kon xodimlari uchun.\n\n" +
                "Mahsulotlarni ko'rish va buyurtma berish uchun do'kon saytiga kiring.",
                { reply_markup: { remove_keyboard: true } }
            );
        }

        // Egasi bo'lsa — 3 kunlik sessiya tekshiruvi
        const isOwner = adminTgId && userId === adminTgId;
        if (isOwner) {
            if (await isOwnerAuthed(shopId, userId)) {
                return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainMenu(hasWebApp) });
            }
            return bot.sendMessage(chatId,
                "🔒 <b>Do'kon egasi kirishi</b>\n\n" +
                "Parolni kiriting:\n" +
                "<i>(Har 3 kunda bir marta so'raladi)</i>",
                { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
            );
        }

        // Xodim
        if (await isAuthed(shopId, userId)) {
            return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainMenu(hasWebApp) });
        }
        return bot.sendMessage(chatId, "🔒 Xush kelibsiz!\n\nParolni kiriting:", {
            reply_markup: { remove_keyboard: true },
        });
    });

    // ── CALLBACK QUERY — qarz to'lash ───────────────────────────────────────
    bot.on("callback_query", async (cq) => {
        const chatId = cq.message?.chat?.id;
        const userId = cq.from?.id;
        const data   = cq.data || "";
        await bot.answerCallbackQuery(cq.id).catch(() => {});

        if (!chatId || !userId) return;
        if (!(await isAuthed(shopId, userId))) return;


        // ── 🚚 DELIVERY CALLBACK ─────────────────────────────────────────────
        if (data.startsWith("delivery:")) {
            const action = data.replace("delivery:", "");
            await bot.answerCallbackQuery(cq.id);

            if (action === "off") {
                await Shop.updateOne({ _id: shopId },
                    { $set: { "webApp.delivery.enabled": false } });
                return bot.sendMessage(chatId,
                    "❌ Yetkazib berish xizmati o'chirildi.",
                    { reply_markup: mainMenu(hasWebApp) });
            }

            if (action === "free") {
                await Shop.updateOne({ _id: shopId }, { $set: {
                    "webApp.delivery.enabled": true,
                    "webApp.delivery.free":    true,
                    "webApp.delivery.minAmount": 0,
                    "webApp.delivery.text":    "",
                }});
                return bot.sendMessage(chatId,
                    "🚚 <b>Bepul yetkazib berish yoqildi!</b>\n\nMijozlar saytda ko'radi.",
                    { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) });
            }

            if (action === "min") {
                await setMode(shopId, userId, "delivery_min_amount");
                return bot.sendMessage(chatId,
                    "💰 Minimal summani kiriting (so'mda):\nMasalan: 50000",
                    { reply_markup: { keyboard: [[{ text: "🚫 Bekor" }]],
                        resize_keyboard: true, one_time_keyboard: true }});
            }

            if (action === "text") {
                await setMode(shopId, userId, "delivery_custom_text");
                return bot.sendMessage(chatId,
                    "✏️ Yangi matnni kiriting:\nMasalan: Toshkent bo'ylab bepul yetkazib beramiz!",
                    { reply_markup: { keyboard: [[{ text: "🚫 Bekor" }]],
                        resize_keyboard: true, one_time_keyboard: true }});
            }
        }

        // ── 💳 CASHBACK SOZLAMA CALLBACK ────────────────────────────────────
        if (data.startsWith("cb_set:")) {
            const action = data.replace("cb_set:", "");
            await bot.answerCallbackQuery(cq.id);

            if (action === "token") {
                await setMode(shopId, userId, "cashback_set_token");
                return bot.sendMessage(chatId,
                    `🤖 <b>Cashback bot token</b>\n\n` +
                    `@BotFather dan yangi bot yarating:\n` +
                    `1. @BotFather → /newbot\n` +
                    `2. Bot nomi va username kiriting\n` +
                    `3. Token nusxalab menga yuboring\n\n` +
                    `<i>Misol: 123456789:AAFxxxx...</i>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            keyboard: [[{ text: "🚫 Bekor" }]],
                            resize_keyboard: true, one_time_keyboard: true,
                        }
                    }
                );
            }

            if (action === "percent") {
                await setMode(shopId, userId, "cashback_set_percent");
                return bot.sendMessage(chatId,
                    `📊 Yangi cashback foizini kiriting (1-50):

` +
                    `Masalan: 5 → har xaridning 5% qaytadi
` +
                    `         10 → har xaridning 10% qaytadi`,
                    { reply_markup: {
                        keyboard: [
                            [{text:"3%"},{text:"5%"},{text:"7%"}],
                            [{text:"10%"},{text:"15%"},{text:"20%"}],
                            [{text:"🚫 Bekor"}],
                        ],
                        resize_keyboard: true, one_time_keyboard: true,
                    }}
                );
            }

            if (action === "minamount") {
                await setMode(shopId, userId, "cashback_set_minamount");
                return bot.sendMessage(chatId,
                    `💰 Minimal xarid summasini kiriting (so'mda):

` +
                    `Masalan: 50000 → 50,000 so'mdan xarid qilsa cashback oladi`,
                    { reply_markup: {
                        keyboard: [
                            [{text:"30000"},{text:"50000"},{text:"70000"}],
                            [{text:"100000"},{text:"150000"}],
                            [{text:"🚫 Bekor"}],
                        ],
                        resize_keyboard: true, one_time_keyboard: true,
                    }}
                );
            }
        }

        // ── [8] SOTUV TAHRIRLASH ─────────────────────────────────────────────
        if (data.startsWith("sale_edit:")) {
            const saleId = data.replace("sale_edit:", "");
            const sale   = await Sale.findOne({ _id: saleId, shopId }).lean();
            if (!sale) {
                await bot.answerCallbackQuery(cq.id, { text: "Sotuv topilmadi" });
                return;
            }
            await bot.answerCallbackQuery(cq.id);
            // Tahrirlash uchun sabab so'rash: to'lov miqdorini o'zgartirish
            await setMode(shopId, userId, `sale_edit_amount:${saleId}`);
            const cur = `Hozir: to'langan ${formatMoney(sale.paidTotal)} so'm, qarz ${formatMoney(sale.debtTotal)} so'm`;
            return bot.sendMessage(chatId,
                `✏️ <b>Sotuv #{${sale.orderNo?.replace("#","") || saleId}}</b>\n${cur}\n\nYangi to'langan summani kiriting (faqat raqam):`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [[{ text: "🚫 Bekor" }]],
                        resize_keyboard: true, one_time_keyboard: true,
                    }
                }
            );
        }

        // ── SOTUV O'CHIRISH ───────────────────────────────────────────────────
        if (data.startsWith("sale_delete:")) {
            const saleId = data.replace("sale_delete:", "");
            // Sabab so'rash
            await setMode(shopId, userId, `sale_delete_reason:${saleId}`);
            await bot.answerCallbackQuery(cq.id);
            return bot.sendMessage(chatId,
                `🗑 <b>Sotuv o'chirish</b>\n\nSababni yozing:\n` +
                `<i>Masalan: Hato kiritildi, Mijoz qaytardi</i>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [
                            [{ text: "❌ Hato kiritildi" }],
                            [{ text: "↩️ Mijoz qaytardi" }],
                            [{ text: "📝 Boshqa sabab" }],
                            [{ text: "🚫 Bekor" }],
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true,
                    }
                }
            );
        }

        // Buyurtma tasdiqlash/bekor
        if (data.startsWith("order_confirm:") || data.startsWith("order_cancel:")) {
            const Order  = require("../models/Order");
            const isConf = data.startsWith("order_confirm:");
            const oid    = data.replace(/^order_(confirm|cancel):/, "");
            try {
                const status = isConf ? "confirmed" : "cancelled";
                const order  = await Order.findOneAndUpdate(
                    { _id: oid, shopId }, { status }, { new: true }
                );
                if (!order) return;
                const label = isConf ? "✅ Tasdiqlandi" : "❌ Bekor qilindi";
                await bot.answerCallbackQuery(cq.id, { text: label });
                await bot.editMessageReplyMarkup(
                    { inline_keyboard: [[{ text: `${label} — ${order.clientName}`, callback_data: "noop" }]] },
                    { chat_id: chatId, message_id: msgId }
                ).catch(() => {});
            } catch (e) { await bot.answerCallbackQuery(cq.id, { text: "Xato!" }); }
            return;
        }

        // Rang tanlash
        if (data.startsWith("wa_theme:")) {
            const themeKey = data.replace("wa_theme:", "");
            const theme = WEBAPP_THEMES[themeKey];
            if (!theme) return;

            const draft = await getDraft(shopId, userId);
            if (!draft || draft.action !== "webapp_create") return;

            // Tanlangan rangni saqlash
            await saveDraft(shopId, userId, { ...draft, step: "groupId", themeKey });
            await bot.answerCallbackQuery(cq.id, { text: `${theme.emoji} ${theme.label} tanlandi!` });

            // Rang preview + guruh ID so'rash
            await bot.editMessageText(
                `✅ Rang: <b>${theme.emoji} ${theme.label}</b>\n` +
                `<code>Asosiy: ${theme.primary} | Aksent: ${theme.accent}</code>\n\n` +
                `<b>3/3</b> — Buyurtma keladigan guruh/kanal ID:`,
                { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
            ).catch(() => {});

            return bot.sendMessage(chatId,
                `📋 Guruh ID kiriting:\n<i>-1001234567890</i>`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [
                            [{ text: `Hozirgi guruh: ${groupChatId || "—"}` }],
                            [{ text: "❌ Bekor" }],
                        ],
                        resize_keyboard: true,
                    }
                }
            );
        }

        // Saytni qayta PIN qilish
        if (data === "wa:repin") {
            const Shop    = require("../models/Shop");
            const shopDoc = await Shop.findById(shopId)
                .select("webApp webappUrl name").lean();
            if (!shopDoc?.webApp?.enabled) return;
            const orderChatId = shopDoc.webApp.orderChatId || groupChatId;
            try {
                const { pinWebAppToGroup } = require("./customerHandlers");
                const { getBot: getCBotFn } = require("./botManager");
                const cBot = getCBotFn(shopId, "customer");
                if (!cBot) throw new Error("Cashback bot topilmadi");
                await pinWebAppToGroup(cBot, shopId);
                await bot.answerCallbackQuery(cq.id, { text: "✅ PIN qilib qo'yildi!" });
            } catch (e) {
                await bot.answerCallbackQuery(cq.id, { text: "❌ Xato: " + e.message });
            }
            return;
        }

        // Buyurtmalar ro'yxati
        if (data.startsWith("wa:orders:")) {
            const Order  = require("../models/Order");
            const filter = data === "wa:orders:new" ? { shopId, status: "new" } : { shopId };
            const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(10).lean();
            if (!orders.length) {
                return bot.sendMessage(chatId, "📭 Buyurtmalar yo'q.");
            }
            for (const o of orders) {
                const lines = o.items.map(it => `• ${it.name} x${it.qty}`).join("\n");
                const statusEmoji = { new:"🆕", confirmed:"✅", delivering:"🚚", done:"✔️", cancelled:"❌" };
                await bot.sendMessage(chatId,
                    `${statusEmoji[o.status]||"📦"} <b>${o.clientName}</b> — ${formatMoney(o.total)} so'm\n` +
                    `📞 ${o.clientPhone}\n${lines}`,
                    { parse_mode: "HTML" }
                );
            }
            return;
        }

        // Billing ma'lumoti
        if (data === "billing:info") {
            const freshShop = await require("../models/Shop").findById(shopId).lean();
            const price = calcMonthlyPrice(freshShop);
            const b = freshShop?.billing;
            const due = b?.nextPaymentDate
                ? require("dayjs")(b.nextPaymentDate).format("DD.MM.YYYY")
                : "—";
            return bot.sendMessage(chatId,
                `💳 <b>To'lov ma'lumotlari</b>\n\n` +
                `🏪 ${freshShop.name}\n` +
                `📦 Tarif: ${freshShop.plan.toUpperCase()}\n` +
                `💰 Oylik to'lov: <b>${price.toLocaleString()} so'm</b>\n` +
                `📅 Muddat: <b>${due}</b>\n\n` +
                `📞 To'lov uchun: @botpos_support`,
                { parse_mode: "HTML" }
            );
        }

        // Katalog CRUD callback lar
        if (data.startsWith("cat:")) {
            return handleCatalogCallback(bot, cq, shopId, getRedis);
        }

        // Qarz to'liq to'lash
        if (data.startsWith("debt_full:")) {
            const debtId = data.replace("debt_full:", "");
            try {
                const debt = await Debt.findOne({ _id: debtId, shopId });
                if (!debt || debt.isClosed) {
                    return bot.sendMessage(chatId, "❌ Qarz topilmadi yoki allaqachon yopilgan.");
                }
                const payer = { tgId: userId, tgName: cq.from?.first_name || "Sotuvchi" };
                debt.payments.push({ amount: debt.remainingDebt, payer });
                debt.remainingDebt = 0;
                debt.isClosed = true;
                await debt.save();
                await addBalance(shopId, debt.remainingDebt || debt.totalDebt);
                await bot.editMessageReplyMarkup({}, { chat_id: chatId, message_id: cq.message.message_id }).catch(() => {});
                await bot.sendMessage(chatId, `✅ Qarz to'liq yopildi!\n💰 ${formatMoney(debt.totalDebt)} so'm`, { parse_mode: "HTML" });
            } catch (e) {
                await bot.sendMessage(chatId, `❌ Xato: ${e.message}`);
            }
        }

        // Qarz qisman to'lash — summa so'rash
        if (data.startsWith("debt_part:")) {
            const debtId = data.replace("debt_part:", "");
            await saveDraft(shopId, userId, { action: "debt_part", debtId });
            await setMode(shopId, userId, "debt_part");
            await bot.sendMessage(chatId, "💳 Qancha to'layapti? Summani kiriting:");
        }
    });

    // ── MESSAGE ─────────────────────────────────────────────────────────────
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const text   = String(msg.text || "").trim();
        if (!userId) return;


        // ── BILLING BLOK TEKSHIRUVI ─────────────────────────────────────────
        const freshShop = await require("../models/Shop").findById(shopId).lean();
        const billingResult = await checkShopBilling(freshShop);
        if (billingResult.blocked) {
            return bot.sendMessage(chatId, billingResult.message, {
                parse_mode: "HTML",
                reply_markup: billingResult.keyboard,
            });
        }

        // Kirish tekshiruvi
        if (!(await isAuthed(shopId, userId))) {
            if (!text) return;
            const ok = await checkPassword(shopId, userId, text, botPassword);
            if (ok) {
                await setAuthed(shopId, userId);
                return bot.sendMessage(chatId, "✅ Kirish muvaffaqiyatli!", { reply_markup: mainMenu() });
            }
            return bot.sendMessage(chatId, "❌ Noto'g'ri parol. Qayta kiriting.");
        }

        // Katalog CRUD text step tekshiruvi (kategoriya/mahsulot qo'shish jarayoni)
        const isCatalogStep = await handleCatalogText(bot, msg, shopId, getRedis);
        if (isCatalogStep) return;

        const mode = await getMode(shopId, userId);

        // ── WEB SAYT ─────────────────────────────────────────────────────────
        // ── 💳 CASHBACK SOZLAMA ──────────────────────────────────────────────
        if (text === "💳 Cashback") {
            const shop = await Shop.findById(shopId)
                .select("cashbackPercent cashbackMinAmount addons").lean();
            const hasCashback = shop?.addons?.cashback;

            if (!hasCashback) {
                return bot.sendMessage(chatId,
                    `💳 <b>Cashback addon</b>

` +
                    `Bu funksiya yoqilmagan.
` +
                    `Admin paneldan "📱 QR Cashback" addonini yoqing.
` +
                    `<i>+30,000 so'm/oy</i>`,
                    { parse_mode: "HTML" }
                );
            }

            const pct    = shop?.cashbackPercent    || 5;
            const minAmt = shop?.cashbackMinAmount  || 50000;

            return bot.sendMessage(chatId,
                `💳 <b>Cashback sozlamalari</b>

` +
                `📊 Hozirgi foiz: <b>${pct}%</b>
` +
                `💰 Minimal xarid: <b>${formatMoney(minAmt)} so'm</b>

` +
                `Mijoz chekdagi QR ni skanerlasa, xaridning ${pct}%i bonusiga qo'shiladi.`,
                {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [
                        [
                            { text: "📊 Foizni o'zgartirish", callback_data: "cb_set:percent" },
                        ],
                        [
                            { text: "💰 Minimal summani o'zgartirish", callback_data: "cb_set:minamount" },
                        ],
                    ]},
                }
            );
        }

        // ── 🚚 YETKAZIB BERISH SOZLAMASI ─────────────────────────────────────
        if (text === "🚚 Yetkazib berish") {
            const shop = await Shop.findById(shopId).select("webApp name").lean();
            const d    = shop?.webApp?.delivery;
            const status = d?.enabled
                ? `✅ Yoqilgan${d.free ? " (bepul)" : d.minAmount > 0 ? ` (${formatMoney(d.minAmount)} so'mdan)` : ""}`
                : "❌ O'chiq";

            return bot.sendMessage(chatId,
                `🚚 <b>Yetkazib berish xizmati</b>\n\nHolat: ${status}`,
                {
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [
                        d?.enabled
                            ? [{ text: "❌ O'chirish", callback_data: "delivery:off" }]
                            : [{ text: "✅ Yoqish (bepul)", callback_data: "delivery:free" }],
                        !d?.enabled
                            ? [{ text: "💰 Minimal summali yoqish", callback_data: "delivery:min" }]
                            : [],
                        d?.enabled
                            ? [{ text: "✏️ Matnni o'zgartirish", callback_data: "delivery:text" }]
                            : [],
                    ].filter(r => r.length > 0)},
                }
            );
        }

        if (text === "🌐 Mening saytim") {
            const Shop    = require("../models/Shop");
            const shopDoc = await Shop.findById(shopId)
                .select("webApp webappUrl name adminTgId")
                .lean();
            const wa = shopDoc?.webApp;

            // ── SAYT YOQ — TARIF TEKSHIRUVI ─────────────────────────────
            if (!wa?.enabled) {
                // Webapp addon yoki biznes tarifmi?
                const freshShopDoc = await require("../models/Shop").findById(shopId).lean();
                if (!canUse(freshShopDoc, "webapp")) {
                    const plan = freshShopDoc?.plan || "boshlanish";
                    const isPro = plan === "pro";
                    return bot.sendMessage(chatId,
                        `🌐 <b>Web App mavjud emas</b>\n\n` +
                        `Sizning tarifingiz: <b>${plan.toUpperCase()}</b>\n\n` +
                        (isPro
                            ? `Pro tarifida Web App yoqilmagan.\nAdmin panelda yoqing (+50,000 so'm/oy).\n📞 @botpos_support`
                            : `Web App uchun tarif yangilang:\n💎 Pro + Web App addon: +50,000 so'm/oy\n🏆 Biznes: bepul (ichida)\n📞 @botpos_support`),
                        { parse_mode: "HTML" }
                    );
                }

                // Ruxsat bor — yaratish
                await setMode(shopId, userId, "webapp_create");
                await saveDraft(shopId, userId, { action: "webapp_create", step: "siteName" });

                const feeMsg = freshShopDoc?.plan === "pro" && freshShopDoc?.addons?.webapp
                    ? `\n💳 <i>+50,000 so'm/oy (addon faol)</i>` : "";

                return bot.sendMessage(chatId,
                    `🌐 <b>Do'kon saytini yaratish</b>${feeMsg}\n\n` +
                    `<b>1/3</b> — Sayt nomini kiriting:\n` +
                    `<i>Masalan: Totli Shirinliklar, AutoParts Uz</i>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            keyboard: [[{ text: shopDoc.name }], [{ text: "❌ Bekor" }]],
                            resize_keyboard: true,
                        }
                    }
                );
            }

            // ── SAYT BOR — BOSHQARUV ──────────────────────────────────────
            const Order = require("../models/Order");
            const [newOrders, totalOrders] = await Promise.all([
                Order.countDocuments({ shopId, status: "new" }),
                Order.countDocuments({ shopId }),
            ]);
            const text2 = [
                `🌐 <b>${wa.siteName || shopDoc.name}</b>`,
                ``,
                `📦 Yangi buyurtmalar: <b>${newOrders}</b>`,
                `📊 Jami buyurtmalar: <b>${totalOrders}</b>`,
                ``,
                `🔗 ${shopDoc.webappUrl}`,
            ].join("\n");
            return bot.sendMessage(chatId, text2, {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🛒 Yangi buyurtmalar", callback_data: "wa:orders:new" }],
                        [{ text: "📋 Barcha buyurtmalar", callback_data: "wa:orders:all" }],
                        [{ text: "📌 Saytni qayta PIN", callback_data: "wa:repin" }],
                        [{ text: "🌐 Saytni ochish", url: shopDoc.webappUrl }],
                    ]
                }
            });
        }

        // ── WEB SAYT YARATISH — BOSQICHLAR ───────────────────────────────────
        if (mode === "webapp_create") {
            const Shop  = require("../models/Shop");
            const draft = await getDraft(shopId, userId);
            if (!draft || draft.action !== "webapp_create") {
                await setMode(shopId, userId, null);
                return;
            }

            if (draft.step === "siteName") {
                // 1. Sayt nomi olindi → RANG tanlash
                const siteName = text.trim();
                if (!siteName || siteName === "❌ Bekor") {
                    await setMode(shopId, userId, null);
                    await clearDraft(shopId, userId);
                    return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(false) });
                }
                await saveDraft(shopId, userId, { action: "webapp_create", step: "theme", siteName });
                // Keyboard olib tashlaymiz — inline tugmalar ishlatamiz
                await bot.sendMessage(chatId, "⌨️", {
                    reply_markup: { remove_keyboard: true }
                }).then(m => bot.deleteMessage(chatId, m.message_id)).catch(() => {});

                return bot.sendMessage(chatId,
                    `✅ Sayt nomi: <b>${siteName}</b>\n\n` +
                    `<b>2/3</b> — Sayt rangini tanlang:\n` +
                    `<i>Do'koningiz uslubiga mos rangni tanlang</i>`,
                    {
                        parse_mode: "HTML",
                        reply_markup: themeKeyboard(),
                    }
                );
            }

            if (draft.step === "theme_chosen") {
                // Agar matn kelsa — guruh ID kutilmoqda
                // (bu step callbackdan keyingi xabarlar uchun)
            }

            if (draft.step === "groupId") {
                // 3. Guruh ID olindi → BOT ADMIN TEKSHIRUVI → sayt yaratamiz
                let orderChatId = text.trim();

                // "Hozirgi guruh: -100..." → ID ni ajratib olamiz
                if (orderChatId.startsWith("Hozirgi guruh:")) {
                    orderChatId = groupChatId;
                }
                if (!orderChatId || orderChatId === "❌ Bekor") {
                    await setMode(shopId, userId, null);
                    await clearDraft(shopId, userId);
                    return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(false) });
                }
                if (!orderChatId.match(/^-?[0-9]+$/)) {
                    return bot.sendMessage(chatId,
                        "❌ Noto'g'ri format. Faqat raqam kiriting:\n<code>-1001234567890</code>",
                        { parse_mode: "HTML" }
                    );
                }

                // ── BOT ADMIN TEKSHIRUVI ──────────────────────────────────
                await bot.sendMessage(chatId, "⏳ Guruhda bot huquqlari tekshirilmoqda...");
                let botIsAdmin = false;
                let adminError = "";
                try {
                    const botInfo = await bot.getMe();
                    const member  = await bot.getChatMember(orderChatId, botInfo.id);
                    const status  = member?.status;

                    if (status === "administrator" || status === "creator") {
                        // Pin ruxsatini tekshirish
                        const canPin = member?.can_pin_messages !== false;
                        if (!canPin) {
                            adminError = "Bot admin, lekin 'Pin messages' ruxsati yo'q.";
                        } else {
                            botIsAdmin = true;
                        }
                    } else if (status === "member") {
                        adminError = "Bot guruhda admin emas.";
                    } else {
                        adminError = "Bot guruhda topilmadi. Avval botni guruhga qo'shing.";
                    }
                } catch (e) {
                    adminError = `Guruhga ulanib bo'lmadi: ${e.message}`;
                }

                if (!botIsAdmin) {
                    return bot.sendMessage(chatId,
                        `⚠️ <b>Diqqat!</b>\n\n❌ ${adminError}\n\n` +
                        `✅ Qadamlar:\n` +
                        `1. Botni guruhga admin qiling\n` +
                        `2. "Pin messages" ruxsatini bering\n` +
                        `3. Keyin guruh ID ni qayta yuboring`,
                        { parse_mode: "HTML" }
                    );
                }

                // Tanlangan tema
                const theme = WEBAPP_THEMES[draft.themeKey] || WEBAPP_THEMES.dark;

                // Shop modeli yangilash — rang bilan
                await Shop.updateOne({ _id: shopId }, {
                    "webApp.enabled":          true,
                    "webApp.siteName":         draft.siteName,
                    "webApp.orderChatId":      orderChatId,
                    "webApp.createdAt":        new Date(),
                    "webApp.theme.primary":    theme.primary,
                    "webApp.theme.accent":     theme.accent,
                    "webApp.theme.bg":         theme.bg,
                    "webApp.theme.cardBg":     theme.cardBg,
                    "webApp.theme.navBg":      theme.navBg,
                    "webApp.theme.text":       theme.text,
                    "webApp.theme.themeKey":   theme.key,
                });

                const updatedShop = await Shop.findById(shopId)
                    .select("webappUrl name webApp")
                    .lean();
                const webappUrl = updatedShop.webappUrl;

                // 4. Guruhga PIN — CASHBACK BOT orqali
                let pinMsgId = null;
                try {
                    // Shop yangilangandan keyin pinWebAppToGroup chaqiramiz
                    // (webappUrl va webApp.orderChatId allaqachon saqlangan)
                    const pinResult = await pinWebAppToGroup(cashbackBot, shopId);
                    pinMsgId = pinResult?.messageId;
                } catch (e) {
                    console.error("[webapp] PIN xato:", e.message);
                }

                // 6. Foydalanuvchiga tasdiq
                await setMode(shopId, userId, null);
                await clearDraft(shopId, userId);

                return bot.sendMessage(chatId,
                    `✅ <b>Saytingiz tayyor!</b>\n\n` +
                    `🌐 <b>${draft.siteName}</b>\n` +
                    `🔗 ${webappUrl}\n\n` +
                    (pinMsgId
                        ? `📌 Guruhga PIN qilib qo'yildi!`
                        : `⚠️ PIN qilib bo'lmadi. Bot guruhda admin bo'lishi kerak.`),
                    {
                        parse_mode: "HTML",
                        reply_markup: {
                            inline_keyboard: [[{
                                text: "🌐 Saytni ochish",
                                web_app: { url: webappUrl },
                            }]],
                        }
                    }
                );
            }
            return;
        }

        // ── 💳 CASHBACK BOT TOKEN ────────────────────────────────────────────
        if (mode === "cashback_set_token") {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(hasWebApp) });
            }

            // Token format: "123456789:AAFxxx..."
            const tokenRx = /^\d{8,12}:[A-Za-z0-9_-]{35}$/;
            if (!tokenRx.test(text.trim())) {
                return bot.sendMessage(chatId,
                    `❌ Token formati noto'g'ri.\n` +
                    `To'g'ri format: <code>123456789:AAFxxxxxxxx...</code>\n\n` +
                    `@BotFather dan oling.`,
                    { parse_mode: "HTML" }
                );
            }

            // Bot tokenni tekshiramiz — getMe() orqali
            await bot.sendMessage(chatId, "⏳ Token tekshirilmoqda...");
            try {
                const TelegramBot = require("node-telegram-bot-api");
                const testBot = new TelegramBot(text.trim(), { polling: false });
                const botInfo  = await testBot.getMe();
                const username = botInfo.username || "";

                // DB ga saqlaymiz
                const { encrypt } = require("../utils/encrypt");
                const encToken    = encrypt(text.trim());
                await Shop.updateOne({ _id: shopId }, {
                    $set: {
                        customerBotToken:    encToken,
                        customerBotUsername: username,
                    }
                });

                await setMode(shopId, userId, null);

                // Bot manager ga yangi botni ulashni aytamiz
                const { getBotManager } = require("./botManager");
                const bm = getBotManager();
                if (bm) bm.reloadShop(shopId).catch(()=>{});

                return bot.sendMessage(chatId,
                    `✅ <b>Cashback bot ulandi!</b>\n\n` +
                    `🤖 @${username}\n\n` +
                    `Endi mijozlaringiz ushbu botga /start yozib\n` +
                    `cashback olishni boshlashadi.\n\n` +
                    `💡 Botni guruhingizga PIN qilishni unutmang!`,
                    { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) }
                );
            } catch(e) {
                return bot.sendMessage(chatId,
                    `❌ Token noto'g'ri yoki bot ishlamayapti.\n` +
                    `@BotFather dan to'g'ri tokenni oling.\n\n` +
                    `Xato: ${e.message}`,
                    { parse_mode: "HTML" }
                );
            }
        }

        // ── 💳 CASHBACK FOIZ ─────────────────────────────────────────────────
        if (mode === "cashback_set_percent") {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(hasWebApp) });
            }
            const pct = parseInt(text.replace(/[^\d]/g,""), 10);
            if (!pct || pct < 1 || pct > 50) {
                return bot.sendMessage(chatId, "❌ 1 dan 50 gacha foiz kiriting:");
            }
            await Shop.updateOne({ _id: shopId }, { $set: { cashbackPercent: pct } });
            await setMode(shopId, userId, null);
            return bot.sendMessage(chatId,
                `✅ <b>Cashback foizi: ${pct}%</b>\n\n` +
                `Har ${formatMoney(100000)} so'm xariddan → <b>${formatMoney(Math.floor(100000*pct/100))} so'm</b> bonus`,
                { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) }
            );
        }

        // ── 💳 CASHBACK MINIMAL SUMMA ─────────────────────────────────────────
        if (mode === "cashback_set_minamount") {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(hasWebApp) });
            }
            const amount = parseInt(text.replace(/[^\d]/g,""), 10);
            if (!amount || amount < 1000) {
                return bot.sendMessage(chatId, "❌ Kamida 1,000 so'm kiriting:");
            }
            await Shop.updateOne({ _id: shopId }, { $set: { cashbackMinAmount: amount } });
            await setMode(shopId, userId, null);
            return bot.sendMessage(chatId,
                `✅ <b>Minimal xarid: ${formatMoney(amount)} so'm</b>\n\n` +
                `Bu summadan kam xaridda cashback berilmaydi.`,
                { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) }
            );
        }

        // ── 🚚 DELIVERY — minimal summa ──────────────────────────────────────
        if (mode === "delivery_min_amount") {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(hasWebApp) });
            }
            const amount = Number(text.replace(/\D/g, ""));
            if (!amount) return bot.sendMessage(chatId, "❌ Noto'g'ri summa. Raqam kiriting:");
            await Shop.updateOne({ _id: shopId }, { $set: {
                "webApp.delivery.enabled":   true,
                "webApp.delivery.free":      false,
                "webApp.delivery.minAmount": amount,
                "webApp.delivery.text":      "",
            }});
            await setMode(shopId, userId, null);
            return bot.sendMessage(chatId,
                `🚚 <b>Yetkazib berish yoqildi!</b>\n${formatMoney(amount)} so'mdan yuqori buyurtmalarda bepul.`,
                { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) });
        }

        // ── 🚚 DELIVERY — custom matn ─────────────────────────────────────────
        if (mode === "delivery_custom_text") {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu(hasWebApp) });
            }
            const cleanText = text.trim().slice(0, 120);
            await Shop.updateOne({ _id: shopId }, { $set: {
                "webApp.delivery.enabled": true,
                "webApp.delivery.text":    cleanText,
            }});
            await setMode(shopId, userId, null);
            return bot.sendMessage(chatId,
                `✅ Matn yangilandi:\n"${cleanText}"`,
                { reply_markup: mainMenu(hasWebApp) });
        }

        // ── [8] SOTUV TAHRIRLASH — yangi summa ───────────────────────────────
        if (mode?.startsWith("sale_edit_amount:")) {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Tahrirlash bekor qilindi.", { reply_markup: mainMenu(hasWebApp) });
            }
            const amount = Number(text.replace(/\D/g, ""));
            if (!amount || amount < 0) {
                return bot.sendMessage(chatId, "❌ Noto'g'ri summa. Faqat raqam kiriting:");
            }
            const saleId = mode.replace("sale_edit_amount:", "");
            const sale   = await Sale.findOne({ _id: saleId, shopId }).lean();
            if (!sale) {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Sotuv topilmadi.", { reply_markup: mainMenu(hasWebApp) });
            }
            // Balansni yangilash
            const oldPaid = sale.paidTotal || 0;
            const newPaid = Math.min(amount, sale.total);
            const diff    = newPaid - oldPaid;
            if (diff !== 0) {
                await Counter.findOneAndUpdate(
                    { shopId, key: "balance" },
                    { $inc: { value: diff } },
                    { upsert: true }
                );
            }
            await Sale.updateOne({ _id: saleId }, {
                $set: {
                    paidTotal: newPaid,
                    debtTotal: sale.total - newPaid,
                }
            });
            // Qarz yangilash
            await Debt.updateMany({ saleId: sale._id }, {
                $set: {
                    totalDebt:     sale.total - newPaid,
                    remainingDebt: sale.total - newPaid,
                    isClosed:      sale.total - newPaid <= 0,
                }
            });
            await setMode(shopId, userId, null);
            return bot.sendMessage(chatId,
                `✅ <b>Sotuv yangilandi</b>\n` +
                `💰 To'langan: <b>${formatMoney(newPaid)} so'm</b>\n` +
                `📌 Qarz: <b>${formatMoney(sale.total - newPaid)} so'm</b>`,
                { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) }
            );
        }

        // ── SOTUV O'CHIRISH — SABAB ─────────────────────────────────────────
        if (mode?.startsWith("sale_delete_reason:")) {
            if (text === "🚫 Bekor") {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ O'chirish bekor qilindi.",
                    { reply_markup: mainMenu(hasWebApp) });
            }

            const saleId = mode.replace("sale_delete_reason:", "");
            const sabab  = text === "📝 Boshqa sabab" ? "Boshqa sabab" : text.replace(/^[❌↩️📝]\s*/, "").trim();

            const Sale = require("../models/Sale");
            const sale = await Sale.findOne({ _id: saleId, shopId }).lean();
            if (!sale) {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Sotuv topilmadi.", { reply_markup: mainMenu(hasWebApp) });
            }

            // Balansdan ayirish
            const Counter = require("../models/Counter");
            const Debt    = require("../models/Debt");
            await Counter.findOneAndUpdate(
                { shopId, key: "balance" },
                { $inc: { value: -(sale.paidTotal || 0) } },
                { upsert: true }
            );
            // Bog'liq qarzni ham o'chirish
            await Debt.deleteMany({ saleId: sale._id });
            // Sotuvni o'chirish
            await Sale.deleteOne({ _id: sale._id });

            await setMode(shopId, userId, null);

            const { formatMoney } = require("../utils/money");
            const itemsLine = (sale.items || []).map(it =>
                `${it.name} x${it.qty||1} (${formatMoney((it.qty||1)*it.price)})`
            ).join(", ");

            // Sotuvchiga: o'chirildi xabari
            const dayjs = require("dayjs");
            const vaqt  = dayjs().tz ? dayjs().tz("Asia/Tashkent").format("DD.MM.YYYY HH:mm") : dayjs().format("DD.MM.YYYY HH:mm");

            await bot.sendMessage(chatId,
                `🗑 <b>SOTUV O'CHIRILDI</b>\n\n` +
                `🆔 ID: ${sale.orderNo?.replace("#","")||"—"}\n` +
                `👤 Sotuvchi: <b>${sale.seller?.tgName||"—"}</b>\n` +
                `💰 Tushgan: <b>${formatMoney(sale.paidTotal||0)} so'm</b>\n` +
                `📝 Sabab: <b>${sabab}</b>`,
                { parse_mode: "HTML", reply_markup: mainMenu(hasWebApp) }
            );

            // Guruhga: o'chirildi
            if (groupChatId) {
                bot.sendMessage(groupChatId,
                    `🗑 <b>SOTUV O'CHIRILDI</b>\n\n` +
                    `🆔 ID: ${sale.orderNo?.replace("#","")||"—"}\n` +
                    `👤 Sotuvchi: <b>${sale.seller?.tgName||"—"}</b>\n` +
                    `💰 Tushgan: <b>${formatMoney(sale.paidTotal||0)} so'm</b>\n` +
                    `🧾 Sabab: <b>${sabab}</b>\n` +
                    `🕐 ${vaqt}`,
                    { parse_mode: "HTML" }
                ).catch(() => {});
            }
            return;
        }

        // ── BEKOR QILISH ────────────────────────────────────────────────────
        if (text === "❌ Bekor qilish") {
            await setMode(shopId, userId, null);
            await clearDraft(shopId, userId);
            return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu() });
        }

        // ── MENYU ────────────────────────────────────────────────────────────
        if (text === "📋 Menyu") {
            const balance = await getBalance(shopId);
            // [10] Balans tarixi — oxirgi 10 operatsiya
            const dayjs = require("dayjs");
            const now   = dayjs();
            const from7 = now.subtract(7, "day").toDate();
            const [recentSales, recentExpenses] = await Promise.all([
                Sale.find({ shopId, createdAt: { $gte: from7 } })
                    .sort({ createdAt: -1 }).limit(5).lean(),
                Expense.find({ shopId, createdAt: { $gte: from7 } })
                    .sort({ createdAt: -1 }).limit(5).lean(),
            ]);
            const ops = [
                ...recentSales.map(s => ({
                    date: s.createdAt,
                    txt:  `✅ +${formatMoney(s.paidTotal)} so'm (sotuv ${s.orderNo})`,
                })),
                ...recentExpenses.map(e => ({
                    date: e.createdAt,
                    txt:  `💸 −${formatMoney(e.amount)} so'm (${e.categoryKey || "chiqim"})`,
                })),
            ].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

            const histLines = ops.length
                ? ["", "📜 <b>So'nggi operatsiyalar:</b>", ...ops.map(o => `  ${o.txt}`)]
                : [];

            const reply = [`📋 <b>Menyu</b>`, `🏦 Balans: <b>${formatMoney(balance)}</b> so'm`, ...histLines].join("\n");
            await bot.sendMessage(chatId, reply, { parse_mode: "HTML", reply_markup: mainMenu() });
            // Katalog boshqarish tugmasi
            await bot.sendMessage(chatId, "📂 Katalog boshqaruvi:", {
                reply_markup: { inline_keyboard: [[{ text: "🛍 Katalogni boshqarish", callback_data: "cat:list" }]] }
            });
            if (webappUrl) {
                await bot.sendMessage(chatId, "📱 WebApp:", {
                    reply_markup: {
                        inline_keyboard: [[{
                            text: "📊 Dashboard",
                            // FIX #3: webappUrl ga ?shop= qo'shamiz (bir marta)
                            web_app: { url: `${webappUrl}?shop=${shopId}` },
                        }]],
                    },
                });
            }
            return;
        }

        // ── QARZLAR ─────────────────────────────────────────────────────────
        if (text === "📌 Qarzlar") {
            const debts = await Debt.find({ shopId, isClosed: false, kind: "customer" })
                .sort({ createdAt: -1 }).limit(15).lean();
            if (!debts.length) return bot.sendMessage(chatId, "✅ Ochiq mijoz qarzlari yo'q.");
            await bot.sendMessage(chatId, `📌 Ochiq qarzlar: <b>${debts.length}</b> ta`, { parse_mode: "HTML" });
            for (const d of debts) {
                await bot.sendMessage(
                    chatId,
                    `📌 Qarz: <b>${formatMoney(d.remainingDebt)}</b> so'm\nTel: ${d.customerPhone || "—"}`,
                    { parse_mode: "HTML", reply_markup: debtKeyboard(d._id) }
                );
            }
            return;
        }

        // ── KASSA YOPISH ─────────────────────────────────────────────────────
        if (text === "🔒 Kassani yopish") {
            const { closeCash } = require("../services/closeCash");
            const s = await closeCash(shopId);  // backup trigger ichida
            const report = [
                `📊 <b>Kassa yopildi</b>`,
                `💰 Tushum: <b>${formatMoney(s.saleSum)}</b> so'm`,
                `💸 Chiqim: <b>${formatMoney(s.expenseSum)}</b> so'm`,
                `📌 Ochiq qarz: <b>${formatMoney(s.debtSum)}</b> so'm`,
                `🏦 Balans: <b>${formatMoney(s.balance)}</b> so'm`,
                `📦 Sotuvlar: ${s.salesCount} ta`,
            ].join("\n");
            return bot.sendMessage(chatId, report, { parse_mode: "HTML" });
        }

        // ── OYLIK HISOBOT (FIX #2 — handler qo'shildi) ───────────────────────
        // ── HISOBOT — 3 xil davr ────────────────────────────────────────────
        if (text === "📅 Bugun" || text === "📆 Hafta" || text === "📊 Oy") {
            try {
                const period = text === "📅 Bugun" ? "today"
                             : text === "📆 Hafta" ? "week" : "month";
                const report = await generateReport(shopId, period);
                return bot.sendMessage(chatId, report, {
                    parse_mode: "HTML",
                    reply_markup: mainMenu(hasWebApp),
                });
            } catch (e) {
                return bot.sendMessage(chatId, `❌ Hisobot xatosi: ${e.message}`);
            }
        }

        // ── SOTISH REJIMI ────────────────────────────────────────────────────
        if (text === "🧁 Sotish") {
            // Redis cache dan katalog (tez!)
            const catalog = await getCatalog(shopId);
            if (catalog.length) {
                await setMode(shopId, userId, "catalog_cat");
                const rows = [];
                for (let i = 0; i < catalog.length; i += 2) {
                    rows.push([catalog[i], catalog[i+1]].filter(Boolean)
                        .map(c => ({ text: `${c.emoji} ${c.category}` })));
                }
                rows.push([{ text: "✏️ Qo'lda yozish" }, { text: "❌ Bekor" }]);
                return bot.sendMessage(chatId, "🛍 Kategoriyani tanlang:",
                    { reply_markup: { keyboard: rows, resize_keyboard: true } }
                );
            }
            // Katalog yo'q — matn rejimi
            await setMode(shopId, userId, "sale");
            return bot.sendMessage(chatId,
                "🧁 Sotuvni yozing:\nMasalan: Tort 140000\n\nYoki 📂 <b>Katalog</b> dan mahsulot qo'shing.",
                { parse_mode: "HTML" }
            );
        }

        // ── CHIQIM REJIMI (FIX #1 — handler qo'shildi) ───────────────────────
        if (text === "💸 Chiqim") {
            await setMode(shopId, userId, "expense_cat");
            return bot.sendMessage(chatId, "💸 Chiqim kategoriyasini tanlang:", {
                reply_markup: expenseCategoryKeyboard(),
            });
        }

        // ── CHIQIM: KATEGORIYA TANLASH ────────────────────────────────────────
        if (mode === "expense_cat") {
            const cat = EXPENSE_CATEGORIES.find(c => text.includes(c.label));
            if (!cat) return bot.sendMessage(chatId, "❓ Kategoriyani tugmadan tanlang.");
            await saveDraft(shopId, userId, { action: "expense", categoryKey: cat.key, categoryLabel: cat.label });
            await setMode(shopId, userId, "expense_amount");
            return bot.sendMessage(chatId, `${cat.emoji} <b>${cat.label}</b> — Summani kiriting:\nMasalan: 150000`, {
                parse_mode: "HTML",
                reply_markup: { keyboard: [[{ text: "❌ Bekor qilish" }]], resize_keyboard: true },
            });
        }

        // ── CHIQIM: SUMMA KIRISH ──────────────────────────────────────────────
        if (mode === "expense_amount") {
            const amount = parseInt(text.replace(/\s/g, ""), 10);
            if (isNaN(amount) || amount < 100) {
                return bot.sendMessage(chatId, "❌ Noto'g'ri summa. Raqam kiriting:");
            }
            const draft = await getDraft(shopId, userId);
            if (!draft) {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Vaqt o'tdi. Qayta boshlang.", { reply_markup: mainMenu() });
            }
            const cat = CAT_MAP[draft.categoryKey];
            await saveDraft(shopId, userId, { ...draft, amount });
            await setMode(shopId, userId, "expense_desc");
            return bot.sendMessage(chatId, `${cat?.emoji || "💸"} ${formatMoney(amount)} so'm\n\nIzoh kiriting (yoki "—" bosing):`, {
                reply_markup: { keyboard: [[{ text: "—" }], [{ text: "❌ Bekor qilish" }]], resize_keyboard: true },
            });
        }

        // ── CHIQIM: IZOH VA SAQLASH ───────────────────────────────────────────
        if (mode === "expense_desc") {
            const draft = await getDraft(shopId, userId);
            if (!draft || !draft.amount) {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Vaqt o'tdi. Qayta boshlang.", { reply_markup: mainMenu() });
            }
            const description = text === "—" ? "" : text;
            const spender = { tgId: userId, tgName: msg.from?.first_name || "Sotuvchi" };
            const cat = CAT_MAP[draft.categoryKey];
            try {
                const result = await saveExpense({
                    shopId, spender,
                    title: `${cat?.label || draft.categoryKey}: ${formatMoney(draft.amount)} so'm`,
                    amount: draft.amount,
                    categoryKey: draft.categoryKey,
                    description,
                });
                const balance = await getBalance(shopId);
                const reply = [
                    `✅ Chiqim saqlandi!`,
                    `${cat?.emoji || "💸"} <b>${cat?.label || draft.categoryKey}</b>`,
                    `💸 Summa: <b>${formatMoney(draft.amount)}</b> so'm`,
                    description ? `📝 Izoh: ${description}` : "",
                    `🏦 Balans: <b>${formatMoney(balance)}</b> so'm`,
                ].filter(Boolean).join("\n");
                await clearDraft(shopId, userId);
                await setMode(shopId, userId, null);
                await bot.sendMessage(chatId, reply, { parse_mode: "HTML", reply_markup: mainMenu() });
                if (groupChatId) {
                    await bot.sendMessage(groupChatId, reply, { parse_mode: "HTML" }).catch(() => {});
                }
            } catch (e) {
                await bot.sendMessage(chatId, `❌ ${e.message}`, { reply_markup: mainMenu() });
                await clearDraft(shopId, userId);
                await setMode(shopId, userId, null);
            }
            return;
        }

        // ── QARZ QISMAN TO'LASH: SUMMA ────────────────────────────────────────
        if (mode === "debt_part") {
            const amount = parseInt(text.replace(/\s/g, ""), 10);
            const draft  = await getDraft(shopId, userId);
            if (!draft?.debtId) {
                await setMode(shopId, userId, null);
                return bot.sendMessage(chatId, "❌ Vaqt o'tdi.", { reply_markup: mainMenu() });
            }
            if (isNaN(amount) || amount < 1) {
                return bot.sendMessage(chatId, "❌ Noto'g'ri summa. Raqam kiriting:");
            }
            try {
                const debt = await Debt.findOne({ _id: draft.debtId, shopId });
                if (!debt || debt.isClosed) throw new Error("Qarz topilmadi");
                const pay = Math.min(amount, debt.remainingDebt);
                const payer = { tgId: userId, tgName: msg.from?.first_name || "Sotuvchi" };
                debt.payments.push({ amount: pay, payer });
                debt.remainingDebt -= pay;
                if (debt.remainingDebt <= 0) { debt.remainingDebt = 0; debt.isClosed = true; }
                await debt.save();
                await addBalance(shopId, pay);
                const status = debt.isClosed
                    ? "✅ Qarz to'liq yopildi!"
                    : `📌 Qolgan qarz: ${formatMoney(debt.remainingDebt)} so'm`;
                await clearDraft(shopId, userId);
                await setMode(shopId, userId, null);
                await bot.sendMessage(chatId,
                    `💳 ${formatMoney(pay)} so'm qabul qilindi.\n${status}`,
                    { parse_mode: "HTML", reply_markup: mainMenu() }
                );
            } catch (e) {
                await bot.sendMessage(chatId, `❌ ${e.message}`, { reply_markup: mainMenu() });
                await setMode(shopId, userId, null);
            }
            return;
        }

        // ── SOTUV: MATN VA OVOZ ─────────────────────────────────────────────
        // QOIDA: AI faqat sotuv/chiqim parse uchun.
        // "Sher yoz", "ob-havo" kabi savollarga javob BERILMAYDI.
        if (mode === "sale" || !mode) {

            // ── OVOZ ────────────────────────────────────────────────────────
            if (msg.voice) {
                const rate = await checkRate(shopId);
                if (!rate.ok) return bot.sendMessage(chatId, rate.reason);
                bot.sendChatAction(chatId, "typing").catch(() => {});
                let sttText = null;
                try {
                    const { decrypt } = require("../utils/encrypt");
                    const botToken  = decrypt(ctx.shop?.botToken || "");
                    const fileInfo  = await bot.getFile(msg.voice.file_id);
                    const fileUrl   = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
                    const audioResp = await fetch(fileUrl);
                    if (audioResp.ok) {
                        sttText = await stt(Buffer.from(await audioResp.arrayBuffer()), shopId, sector);
                    }
                } catch (e) { console.error("[voice]", e.message); }

                if (!sttText) {
                    return bot.sendMessage(chatId,
                        "🎤 Ovoz tushunilmadi. Qayta yoki yozma yuboring.");
                }
                return handleAI(bot, chatId, shopId, msg, sttText, sector, ctx, groupChatId, true);
            }

            // ── MATN ────────────────────────────────────────────────────────
            if (!text) return;

            // 1. Tez regex parser (0 token)
            const quickItems = parseSaleText(text);
            if (quickItems?.length) {
                return doSaveSale(bot, chatId, shopId, msg, quickItems, groupChatId, '', null, ctx);
            }

            // 2. shopChat — soha + katalog kontekst bilan
            return handleAI(bot, chatId, shopId, msg, text, sector, ctx, groupChatId, false);
        }
    });

    console.log(`[shopHandlers] ✅ Handler ulandi: ${ctx.shop?.name || shopId}`);
}


// ─── WEBAPP RANGLAR ───────────────────────────────────────────────────────────
const WEBAPP_THEMES = {
    dark:    { key:"dark",    emoji:"🖤", label:"Qora (klassik)",   primary:"#0d0d0d", accent:"#f5c842", bg:"#faf6f0", cardBg:"#ffffff", navBg:"#ffffff", text:"#0d0d0d" },
    light:   { key:"light",   emoji:"🤍", label:"Oq (minimal)",     primary:"#1a1a1a", accent:"#3b82f6", bg:"#f8fafc", cardBg:"#ffffff", navBg:"#ffffff", text:"#1a1a1a" },
    gold:    { key:"gold",    emoji:"💛", label:"Oltin (luxe)",     primary:"#7c5c0a", accent:"#f5c842", bg:"#fffbf0", cardBg:"#fff9e6", navBg:"#fff9e6", text:"#3d2f00" },
    green:   { key:"green",   emoji:"💚", label:"Yashil (tabiiy)",  primary:"#1a4731", accent:"#22c55e", bg:"#f0faf4", cardBg:"#ffffff", navBg:"#ffffff", text:"#1a4731" },
    red:     { key:"red",     emoji:"❤️", label:"Qizil (energiya)", primary:"#7f1d1d", accent:"#ef4444", bg:"#fff5f5", cardBg:"#ffffff", navBg:"#ffffff", text:"#7f1d1d" },
    purple:  { key:"purple",  emoji:"💜", label:"Binafsha (zamonaviy)", primary:"#3b0764", accent:"#a855f7", bg:"#faf5ff", cardBg:"#ffffff", navBg:"#ffffff", text:"#3b0764" },
    orange:  { key:"orange",  emoji:"🧡", label:"To'q sariq (issiq)", primary:"#7c2d12", accent:"#f97316", bg:"#fff7ed", cardBg:"#ffffff", navBg:"#ffffff", text:"#7c2d12" },
    blue:    { key:"blue",    emoji:"🩵", label:"Ko'k (professional)", primary:"#1e3a5f", accent:"#3b82f6", bg:"#eff6ff", cardBg:"#ffffff", navBg:"#ffffff", text:"#1e3a5f" },
};

function themeKeyboard() {
    const rows = Object.values(WEBAPP_THEMES).map(t => ([{
        text: `${t.emoji} ${t.label}`,
        callback_data: `wa_theme:${t.key}`,
    }]));
    return { inline_keyboard: rows };
}


// ─── handleAI — shopChat orqali sotuv/chiqim/savol ─────────────────────────
async function handleAI(bot, chatId, shopId, msg, userMsg, sector, ctx, groupChatId, fromVoice) {
    const { formatMoney } = require("../utils/money");
    const { getCatalog }  = require("../services/catalogCache");
    const Counter = require("../models/Counter");
    const { shopChat, parseAIResponse, getTodaySales } = require("../services/shopAI");

    bot.sendChatAction(chatId, "typing").catch(() => {});

    const catalog    = await getCatalog(shopId);
    const balanceDoc = await Counter.findOne({ shopId, key: "balance" }).lean();
    const balance    = Number(balanceDoc?.value || 0);
    const todaySales = await getTodaySales(shopId);

    const aiRaw  = await shopChat({ shopId, sector, userMsg, catalog, history: [], balance, todaySales });
    const parsed = parseAIResponse(aiRaw);

    // ── SOTUV ──────────────────────────────────────────────────────────────
    if (parsed.type === "sale" && parsed.items?.length) {
        const prefix = fromVoice ? `🎤 <i>${userMsg}</i>\n` : "";
        return doSaveSale(bot, chatId, shopId, msg, parsed.items, groupChatId, prefix, parsed.phone, ctx);
    }

    // ── CHIQIM ─────────────────────────────────────────────────────────────
    if (parsed.type === "expense" && parsed.amount) {
        const { mongoose } = require("../db");
        const Counter = require("../models/Counter");
        const Expense = require("../models/Expense");
        const spender = { tgId: msg.from?.id, tgName: msg.from?.first_name || "Sotuvchi" };
        const session = await mongoose.startSession();
        try {
            session.startTransaction();
            const bal = await Counter.findOne({ shopId, key: "balance" }, null, { session }).lean();
            if ((bal?.value || 0) < parsed.amount) {
                await session.abortTransaction();
                return bot.sendMessage(chatId, "❌ Balans yetarli emas.");
            }
            const oDoc = await Counter.findOneAndUpdate({ shopId, key: "orderNo" }, { $inc: { value: 1 } }, { new: true, upsert: true, session });
            const orderNo = `#${String(oDoc.value).padStart(4, "0")}`;
            await Expense.create([{ shopId, orderNo, spender, title: parsed.description || parsed.categoryKey, amount: parsed.amount, categoryKey: parsed.categoryKey, description: parsed.description || "" }], { session });
            await Counter.findOneAndUpdate({ shopId, key: "balance" }, { $inc: { value: -parsed.amount } }, { session });
            await session.commitTransaction();
            return bot.sendMessage(chatId, `💸 Chiqim: <b>${formatMoney(parsed.amount)}</b> so'm (${parsed.categoryKey})`, { parse_mode: "HTML" });
        } catch (e) {
            await session.abortTransaction();
            return bot.sendMessage(chatId, `❌ ${e.message}`);
        } finally { session.endSession(); }
    }

    // ── OFF_TOPIC — sotuv bilan bog'liq emas ─────────────────────────────
    if (parsed.type === "off_topic") {
        return bot.sendMessage(chatId,
            "❌ Bu savolga javob bera olmayman.\n\n" +
            "Men faqat <b>sotuv va chiqim</b> bilan ishlayman.\n" +
            "Misol: <code>Tort 140000, Pepsi 18000</code>",
            { parse_mode: "HTML" }
        );
    }

    // ── SAVOL — balans, narx, bugun sotilgan ─────────────────────────────
    if (parsed.type === "text" && parsed.text) {
        return bot.sendMessage(chatId, parsed.text, { parse_mode: "HTML" });
    }

    // Tushunilmadi
    return bot.sendMessage(chatId,
        "❓ Tushunilmadi.\nMisol: <code>Tort 140000, Pepsi 18000</code>",
        { parse_mode: "HTML" }
    );
}

// ─── doSaveSale — sotuvni DB ga saqlash + chek chiqarish ────────────────────
async function doSaveSale(bot, chatId, shopId, msg, items, groupChatId, prefix = "", phone = null, ctx = null) {
    const { mongoose } = require("../db");
    const Sale    = require("../models/Sale");
    const Debt    = require("../models/Debt");
    const Counter = require("../models/Counter");
    const { formatMoney } = require("../utils/money");
    const dayjs = require("dayjs");

    const seller = { tgId: msg.from?.id, tgName: msg.from?.first_name || "Sotuvchi" };

    // Telefon — saleParser.extractPhone yoki items._phone
    if (!phone) {
        phone = items._phone || extractPhone(items) || null;
    }

    const session = await mongoose.startSession();
    try {
        session.startTransaction();

        // Jami hisob
        let total = 0, paidTotal = 0;
        for (const it of items) {
            const line = (it.qty || 1) * (it.price || 0);
            total     += line;
            paidTotal += (it.paid ?? line);
        }
        paidTotal   = Math.min(paidTotal, total);
        const debtTotal = Math.max(0, total - paidTotal);

        // OrderNo
        const oDoc = await Counter.findOneAndUpdate(
            { shopId, key: "orderNo" },
            { $inc: { value: 1 } },
            { new: true, upsert: true, session }
        );
        const orderNo = `#${String(oDoc.value).padStart(4, "0")}`;

        // Sale saqlash
        const [sale] = await Sale.create([{
            shopId, orderNo, seller,
            phone: phone || null,
            items, total, paidTotal, debtTotal,
        }], { session });

        // Balans oshirish
        await Counter.findOneAndUpdate(
            { shopId, key: "balance" },
            { $inc: { value: paidTotal } },
            { new: true, upsert: true, session }
        );

        // Qarz yaratish
        if (debtTotal > 0) {
            await Debt.create([{
                shopId, saleId: sale._id,
                customerPhone: phone || null,
                totalDebt: debtTotal, remainingDebt: debtTotal, seller,
            }], { session });
        }

        await session.commitTransaction();

        // ─── CHEK XABARI ──────────────────────────────────────────────────
        const now   = dayjs().tz ? dayjs().tz("Asia/Tashkent") : dayjs();
        const vaqt  = now.format("DD.MM.YYYY HH:mm");
        const { WEBAPP_BASE_URL } = require("../config");

        // Mahsulotlar qatori
        const itemsLine = items.map(it => {
            const qty = it.qty || 1;
            const sum = qty * it.price;
            return `${it.name} x${qty} (${formatMoney(sum)})`;
        }).join(", ");

        // To'lov holati
        let payStatus, payEmoji;
        if (debtTotal === 0) {
            payStatus = `${formatMoney(paidTotal)} so'm`;
            payEmoji  = "✅";
        } else if (paidTotal === 0) {
            payStatus = `Nasiya`;
            payEmoji  = "📌";
        } else {
            payStatus = `${formatMoney(paidTotal)} so'm (qarz: ${formatMoney(debtTotal)})`;
            payEmoji  = "💳";
        }

        // ── SOTUVCHIGA: qisqa xabar + inline tugmalar ──────────────────────
        const shortMsg = [
            `✅ <b>SOTUV</b>`,
            ``,
            `🆔 ID: ${orderNo.replace("#", "")}`,
            `👤 Sotuvchi: ${seller.tgName}`,
            `🧾 Items: ${itemsLine}`,
            `💰 Tushgan: <b>${formatMoney(paidTotal)} so'm</b>`,
            debtTotal > 0 ? `📌 Qarz: <b>${formatMoney(debtTotal)} so'm</b>` : "",
            phone ? `📞 Tel: ${phone}` : "",
            `🕐 ${vaqt}`,
        ].filter(Boolean).join("\n");

        // Chekni ko'rish uchun WebApp URL
        const checkUrl = `${WEBAPP_BASE_URL}/check?id=${sale._id}&shop=${shopId}`;
        // QR: mijoz cashback bot ga shu kodni yuboradi
        const { WEBAPP_BASE_URL: _WB } = require("../config");

        const inlineKb = { inline_keyboard: [
            [{ text: "🧾 Chekni chop etish", web_app: { url: checkUrl } }],
            [
                { text: "✏️ Tahrirlash", callback_data: `sale_edit:${sale._id}` },
                { text: "🗑 O'chirish",  callback_data: `sale_delete:${sale._id}` },
            ],
        ]};

        await bot.sendMessage(chatId, shortMsg, {
            parse_mode: "HTML",
            reply_markup: inlineKb,
        });

        // Asosiy menyu qaytadi (alohida xabar)
        await bot.sendMessage(chatId, "➕ Keyingi sotuv:", {
            reply_markup: mainMenu(!!ctx?.shop?.webApp?.enabled),
        });

        // ── QR KOD YARATISH — bir martalik cashback uchun ──────────────────────
        try {
            const { makeQrCode } = require("./customerHandlers");
            const qrCode = makeQrCode(String(sale._id));
            await Sale.updateOne({ _id: sale._id }, { $set: { qrCode } });
            sale.qrCode = qrCode;
        } catch(e) { console.error("[QR]", e.message); }

        // ── SOCKET.IO: printer APK ga real-time event ───────────────────────
        try {
            if (global._io) {
                global._io.to(`shop:${shopId}`).emit("print:receipt", {
                    shopId:   String(shopId),
                    shopName: ctx?.shop?.name || "",
                    orderNo:  sale.orderNo,
                    seller:   seller.tgName,
                    items:    items.map(it => ({
                        name:  it.name,
                        qty:   it.qty || 1,
                        price: it.price,
                        total: (it.qty || 1) * it.price,
                    })),
                    total,
                    paidTotal,
                    debtTotal,
                    phone:    phone || null,
                    vaqt,
                    createdAt: new Date().toISOString(),
                });
            }
        } catch (e) {
            console.error("[socket] print emit xato:", e.message);
        }

        // ── GURUHGA: to'liq sotuv xabari ───────────────────────────────────
        if (groupChatId) {
            const groupMsg = [
                `✅ <b>SOTUV</b>`,
                ``,
                `👤 Sotuvchi: <b>${seller.tgName}</b>`,
                `🧾 Items: ${itemsLine}`,
                `💰 Tushgan: <b>${formatMoney(paidTotal)} so'm</b>`,
                debtTotal > 0 ? `📌 Qarz: <b>${formatMoney(debtTotal)} so'm</b>` : "",
                phone ? `📞 Tel: ${phone}` : "",
                `🕐 ${vaqt}`,
            ].filter(Boolean).join("\n");
            bot.sendMessage(groupChatId, groupMsg, { parse_mode: "HTML" }).catch(() => {});
        }

        // ── [2] EGAGA REAL-TIME: xodim sotsa — ega bildiriladi ─────────────
        // Faqat xodim sotgan bo'lsa (ega o'zi sotsa — takrorlanmasin)
        if (adminTgId && userId !== adminTgId) {
            const ownerMsg = [
                `🔔 <b>Yangi sotuv</b>`,
                `👤 ${seller.tgName}: <b>${formatMoney(paidTotal)} so'm</b>`,
                `🧾 ${itemsLine}`,
                debtTotal > 0 ? `📌 Qarz: ${formatMoney(debtTotal)} so'm` : "",
            ].filter(Boolean).join("\n");
            bot.sendMessage(adminTgId, ownerMsg, { parse_mode: "HTML" }).catch(() => {});
        }

    } catch (e) {
        await session.abortTransaction();
        bot.sendMessage(chatId, `❌ Sotuv xatosi: ${e.message}`);
    } finally {
        session.endSession();
    }
}


module.exports = { attachHandlers, getBalance, addBalance };
