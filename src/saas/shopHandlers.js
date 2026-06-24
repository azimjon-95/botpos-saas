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
const { REDIS_URL, AUTH_TTL_SECONDS } = require("../config");

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
function getRedis() {
    if (!Redis || !REDIS_URL) return null;
    if (!_redis) {
        _redis = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 2,
            retryStrategy: t => Math.min(t * 500, 5000),
        });
        _redis.on("error", e => console.error("[redis]", e.message));
    }
    return _redis;
}

function authKey(shopId, userId)  { return `auth:${shopId}:${userId}`; }
function modeKey(shopId, userId)  { return `mode:${shopId}:${userId}`; }
function draftKey(shopId, userId) { return `draft:${shopId}:${userId}`; }
function cartKey(shopId, userId)  { return `cart:${shopId}:${userId}`; }  // Savat

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
async function checkPassword(shopId, userId, text, botPassword) {
    const worker = await Worker.findOne({ shopId, tgId: userId, isActive: true }).lean();
    if (worker) return true;
    return String(text || "").trim() === String(botPassword || "1234").trim();
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

// ─── OYLIK HISOBOT ────────────────────────────────────────────────────────────
async function monthlyReport(shopId) {
    const dayjs  = require("dayjs");
    const tz     = require("dayjs/plugin/timezone");
    const utc    = require("dayjs/plugin/utc");
    dayjs.extend(utc); dayjs.extend(tz);
    const TZ = "Asia/Tashkent";
    const from = dayjs().tz(TZ).startOf("month").toDate();
    const to   = dayjs().tz(TZ).endOf("month").toDate();
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

    const month = dayjs().tz(TZ).format("MMMM YYYY");
    return [
        `📆 <b>${month} oylik hisobot</b>`,
        ``,
        `💰 Jami tushum: <b>${formatMoney(saleSum)}</b> so'm`,
        `📌 Nasiya (oy): <b>${formatMoney(debtSum)}</b> so'm`,
        `💸 Chiqim: <b>${formatMoney(expenseSum)}</b> so'm`,
        `📉 Foyda: <b>${formatMoney(saleSum - expenseSum)}</b> so'm`,
        ``,
        `🏦 Hozirgi balans: <b>${formatMoney(balance)}</b> so'm`,
        `📌 Ochiq qarzlar: <b>${formatMoney(openDebt)}</b> so'm`,
        ``,
        `📊 Sotuvlar: ${sales.length} ta`,
        `🧾 Chiqimlar: ${expenses.length} ta`,
    ].join("\n");
}

// ─── HANDLER ULASH ───────────────────────────────────────────────────────────
function attachHandlers(bot, ctx) {
    const { shopId, groupChatId, adminTgId, botPassword } = ctx;
    const sector = ctx.shop?.sector || "boshqa";
    // FIX #3: webappUrl dan ?shop= olib tashlandi — u allaqachon URL da bor
    const webappUrl = ctx.webappUrl?.replace(/\?shop=.*$/, "");
    // openaiKey endi markaziy — config.js da OPENAI_API_KEY

    // ── /start ──────────────────────────────────────────────────────────────
    bot.onText(/\/start/, async (msg) => {
        const userId = msg.from?.id;
        const chatId = msg.chat.id;
        if (!userId) return;
        if (await isAuthed(shopId, userId)) {
            return bot.sendMessage(chatId, "🏠 Asosiy menyu:", { reply_markup: mainMenu() });
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

        // ── BEKOR QILISH ────────────────────────────────────────────────────
        if (text === "❌ Bekor qilish") {
            await setMode(shopId, userId, null);
            await clearDraft(shopId, userId);
            return bot.sendMessage(chatId, "❌ Bekor qilindi.", { reply_markup: mainMenu() });
        }

        // ── MENYU ────────────────────────────────────────────────────────────
        if (text === "📋 Menyu") {
            const balance = await getBalance(shopId);
            const reply = [`📋 <b>Menyu</b>`, `🏦 Balans: <b>${formatMoney(balance)}</b> so'm`].join("\n");
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
            const s = await closeCash(shopId);
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
        if (text === "📆 Oylik hisobot") {
            try {
                const report = await monthlyReport(shopId);
                return bot.sendMessage(chatId, report, { parse_mode: "HTML" });
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

        // ── SOTUV: MATN YOKI OVOZ ────────────────────────────────────────────
        if (mode === "sale" || !mode) {
            // Ovozli xabar
            // ── OVOZLI XABAR — Telegram STT (BEPUL) + smart parse ───────
            if (msg.voice) {
                // Telegram voice xabarini matn ga aylantirish
                // Telegram Bot API: voice → getFile → Whisper URL
                // LEKIN: voice.file_path → to'g'ri Whisper bilan download qilamiz
                // Telegram o'zi STT qilmaydi — biz bot.getFile + Whisper fallback ishlatamiz
                // STRATEGIYA: avval regex, keyin AI (99% tejash)

                bot.sendChatAction(chatId, "typing").catch(() => {});

                let sttText = null;

                // Ovoz faylini yuklab, Whisper bilan matn ga aylantiramiz
                // (faqat bu bir yo'l — Telegram o'z STT API sini bot larga bermaydi)
                try {
                    const fileInfo = await bot.getFile(msg.voice.file_id);
                    const { OPENAI_API_KEY } = require('../config');

                    if (OPENAI_API_KEY) {
                        // Limit tekshiruvi
                        const lim = await checkLimits(shopId);
                        if (!lim.allowed) {
                            const errMsg = lim.reason === "limit_reached"
                                ? `⚠️ Bu oy AI limiti to'ldi. Yozma kiriting.`
                                : `⏳ ${lim.waitSec||2} soniya kuting.`;
                            return bot.sendMessage(chatId, errMsg);
                        }

                        // Whisper bilan STT (faqat 1 marta — parse va STT)
                        const botToken = require('../utils/encrypt').decrypt(ctx.shop?.botToken || "");
                        const fileUrl  = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;
                        const audioResp = await fetch(fileUrl);
                        if (audioResp.ok) {
                            const audioBuffer = Buffer.from(await audioResp.arrayBuffer());
                            const { whisperFallback } = require('../services/openaiService');
                            sttText = await whisperFallback(audioBuffer, shopId, sector);
                        }
                    }
                } catch (e) {
                    console.error("[voice]", e.message);
                }

                if (!sttText) {
                    return bot.sendMessage(chatId,
                        "🎤 Ovoz tushunilmadi.\n✏️ Yozma yuboring: <code>Tort 140000, Pepsi 18000</code>",
                        { parse_mode: "HTML" }
                    );
                }

                // Katalog mahsulotlari (token tejash)
                const { getCatalog } = require("../services/catalogCache");
                const catalogGroups = await getCatalog(shopId);
                const catalogItems  = catalogGroups.flatMap(g => g.items);

                // Smart parse: regex → katalog → AI
                const result = await processVoiceSale(sttText, shopId, sector, catalogItems);

                if (!result.items?.length) {
                    return bot.sendMessage(chatId,
                        `🎤 Eshitildi: "<i>${sttText}</i>"\n\n` +
                        `❓ Sotuv topilmadi.\n` +
                        `Misol: "<b>Tort 140000, Pepsi 18000</b>"`,
                        { parse_mode: "HTML" }
                    );
                }

                // Sotuv saqlash
                const seller = { tgId: userId, tgName: msg.from?.first_name || "Sotuvchi" };
                try {
                    const saveResult = await saveSale({ shopId, seller, items: result.items });
                    const lines = result.items.map(it =>
                        `• ${it.name} x${it.qty||1} = ${formatMoney((it.qty||1)*it.price)}`
                    ).join("\n");
                    const reply = [
                        `🎤✅ <b>${saveResult.orderNo}</b>${result.aiUsed?" (AI)":""}`,
                        `📝 <i>${sttText}</i>`,
                        lines,
                        `💰 <b>${formatMoney(saveResult.paidTotal)}</b> so'm`,
                        saveResult.debtTotal > 0 ? `📌 Qarz: <b>${formatMoney(saveResult.debtTotal)}</b>` : "",
                    ].filter(Boolean).join("\n");
                    await bot.sendMessage(chatId, reply, { parse_mode:"HTML", reply_markup:mainMenu() });
                    if (groupChatId) await bot.sendMessage(groupChatId, reply, { parse_mode:"HTML" }).catch(()=>{});
                } catch (e) {
                    await bot.sendMessage(chatId, `❌ ${e.message}`, { reply_markup:mainMenu() });
                }
                return;
            }
            if (!text) return;

            // Avval oddiy parse, keyin AI
            let items = parseSaleText(text);
            // AI parse — faqat oddiy parser topamasa, limit bo'lmasa
            if (!items) {
                const lim = await checkLimits(shopId);
                if (lim.allowed) {
                    const normalized = await parseSaleAI(text, shopId, sector);
                    if (normalized) items = parseSaleText(normalized);
                }
            }

            if (items && items.length > 0) {
                const seller = { tgId: userId, tgName: msg.from?.first_name || "Sotuvchi" };
                try {
                    const result = await saveSale({ shopId, seller, items });
                    const reply = [
                        `✅ Sotuv saqlandi! <b>${result.orderNo}</b>`,
                        items.map(it => `• ${it.name} x${it.qty || 1} = ${formatMoney((it.qty||1)*it.price)}`).join("\n"),
                        `💰 To'landi: <b>${formatMoney(result.paidTotal)}</b> so'm`,
                        result.debtTotal > 0 ? `📌 Qarz: <b>${formatMoney(result.debtTotal)}</b> so'm` : "",
                    ].filter(Boolean).join("\n");
                    await bot.sendMessage(chatId, reply, { parse_mode: "HTML" });
                    if (groupChatId) await bot.sendMessage(groupChatId, reply, { parse_mode: "HTML" }).catch(() => {});
                } catch (e) {
                    await bot.sendMessage(chatId, `❌ Sotuv xatosi: ${e.message}`);
                }
                return;
            }

            // Chiqim bo'lishi mumkin (AI bilan)
            if (OPENAI_API_KEY) {
                const lim2 = await checkLimits(shopId);
            const exp  = lim2.allowed ? await parseExpenseAI(text, shopId) : null;
                if (exp?.amount && exp?.categoryKey) {
                    const spender = { tgId: userId, tgName: msg.from?.first_name || "Sotuvchi" };
                    try {
                        await saveExpense({
                            shopId, spender,
                            title: exp.description || exp.categoryKey,
                            amount: exp.amount,
                            categoryKey: exp.categoryKey,
                            description: exp.description || "",
                        });
                        const cat = CAT_MAP[exp.categoryKey];
                        return bot.sendMessage(chatId,
                            `✅ Chiqim (AI): ${cat?.emoji || ""} ${formatMoney(exp.amount)} so'm`,
                            { parse_mode: "HTML" }
                        );
                    } catch (e) {
                        return bot.sendMessage(chatId, `❌ ${e.message}`);
                    }
                }
            }

            return bot.sendMessage(chatId,
                "❓ Format noto'g'ri.\nSotuv: <code>Tort 140000</code>\nChiqim: 💸 tugmasini bosing",
                { parse_mode: "HTML" }
            );
        }
    });

    console.log(`[shopHandlers] ✅ Handler ulandi: ${ctx.shop?.name || shopId}`);
}

module.exports = { attachHandlers, getBalance, addBalance };
