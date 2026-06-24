// src/saas/catalogBot.js
// Bot orqali katalog boshqarish (CRUD)
// Admin/sotuvchi o'z botidan kategoriya va mahsulot qo'shadi
"use strict";
const {
    getCatalog, addProduct, deleteProduct,
    deleteCategory, updateProductPrice, updateCategory,
} = require("../services/catalogCache");
const Product = require("../models/Product");
const { formatMoney } = require("../utils/money");

// ─── STATE KEY LAR (Redis) ────────────────────────────────────────────────────
const CATALOG_STEP_KEY = (shopId, uid) => `cstep:${shopId}:${uid}`;
const CATALOG_DATA_KEY = (shopId, uid) => `cdata:${shopId}:${uid}`;

// ─── EMOJI RO'YXATI (kategoriya uchun) ───────────────────────────────────────
const EMOJIS = ["🎂","🧁","🥤","🍰","🍩","🥐","🍫","🎁","🍓","🍪","🥧","🍮","🧃","☕","🍵","🥛","📦","⭐"];

// ─── TUGMALAR ─────────────────────────────────────────────────────────────────

function catalogMainKeyboard() {
    return {
        inline_keyboard: [
            [{ text: "📂 Kategoriyalar ro'yxati",  callback_data: "cat:list" }],
            [{ text: "➕ Yangi kategoriya qo'shish", callback_data: "cat:add_cat" }],
            [{ text: "❌ Yopish",                    callback_data: "cat:close" }],
        ],
    };
}

function categoryActionsKeyboard(category) {
    const enc = encodeURIComponent(category);
    return {
        inline_keyboard: [
            [{ text: "📋 Mahsulotlar",        callback_data: `cat:prods:${enc}` }],
            [{ text: "➕ Mahsulot qo'shish",  callback_data: `cat:add_prod:${enc}` }],
            [{ text: "✏️ Kategoriya nomi",    callback_data: `cat:edit_cat:${enc}` }],
            [{ text: "🗑 Kategoriyani o'chirish", callback_data: `cat:del_cat:${enc}` }],
            [{ text: "◀️ Orqaga",             callback_data: "cat:list" }],
        ],
    };
}

function productActionsKeyboard(productId, category) {
    const enc = encodeURIComponent(category);
    return {
        inline_keyboard: [
            [{ text: "💰 Narxni o'zgartirish", callback_data: `cat:edit_price:${productId}` }],
            [{ text: "🗑 O'chirish",            callback_data: `cat:del_prod:${productId}` }],
            [{ text: "◀️ Orqaga",              callback_data: `cat:prods:${enc}` }],
        ],
    };
}

function emojiKeyboard() {
    const rows = [];
    for (let i = 0; i < EMOJIS.length; i += 6) {
        rows.push(EMOJIS.slice(i, i+6).map(e => ({ text: e, callback_data: `cat:emoji:${e}` })));
    }
    rows.push([{ text: "✏️ O'zim yozaman", callback_data: "cat:emoji:custom" }]);
    return { inline_keyboard: rows };
}

function confirmKeyboard(yesData, noData = "cat:list") {
    return {
        inline_keyboard: [[
            { text: "✅ Ha, o'chirish", callback_data: yesData },
            { text: "❌ Yo'q",          callback_data: noData },
        ]],
    };
}

// ─── KATALOG MENYUSI YUBORISH ─────────────────────────────────────────────────
async function sendCatalogMenu(bot, chatId, shopId) {
    const catalog = await getCatalog(shopId);
    const lines = catalog.length
        ? catalog.map(c => `${c.emoji} <b>${c.category}</b> — ${c.items.length} ta mahsulot`).join("\n")
        : "📭 Katalog bo'sh";

    await bot.sendMessage(chatId,
        `🛍 <b>Katalog boshqaruvi</b>\n\n${lines}`,
        { parse_mode: "HTML", reply_markup: catalogMainKeyboard() }
    );
}

// ─── ASOSIY HANDLER ───────────────────────────────────────────────────────────
async function handleCatalogCallback(bot, cq, shopId, getRedis) {
    const chatId  = cq.message?.chat?.id;
    const msgId   = cq.message?.message_id;
    const uid     = cq.from?.id;
    const data    = cq.data || "";
    const edit    = (text, kb) => bot.editMessageText(text, {
        chat_id: chatId, message_id: msgId,
        parse_mode: "HTML", reply_markup: kb,
    }).catch(() => {});

    await bot.answerCallbackQuery(cq.id).catch(() => {});

    const r = getRedis();
    const stepKey = CATALOG_STEP_KEY(shopId, uid);
    const dataKey = CATALOG_DATA_KEY(shopId, uid);

    // ── YOPISH ────────────────────────────────────────────────────────────────
    if (data === "cat:close") {
        return bot.deleteMessage(chatId, msgId).catch(() => {});
    }

    // ── RO'YXAT ───────────────────────────────────────────────────────────────
    if (data === "cat:list") {
        const catalog = await getCatalog(shopId);
        const lines = catalog.length
            ? catalog.map(c => `${c.emoji} <b>${c.category}</b> — ${c.items.length} ta`).join("\n")
            : "📭 Katalog bo'sh";
        return edit(`🛍 <b>Katalog</b>\n\n${lines}`, catalogMainKeyboard());
    }

    // ── YANGI KATEGORIYA — NOM ────────────────────────────────────────────────
    if (data === "cat:add_cat") {
        if (r) await r.set(stepKey, "new_cat_name", "EX", 300);
        return edit(
            "📂 <b>Yangi kategoriya</b>\n\nKategoriya nomini yozing:\n<i>Masalan: Tortlar, Ichimliklar, Pirojniylar</i>",
            { inline_keyboard: [[{ text: "❌ Bekor", callback_data: "cat:list" }]] }
        );
    }

    // ── KATEGORIYA MAHSULOTLARI ────────────────────────────────────────────────
    if (data.startsWith("cat:prods:")) {
        const cat = decodeURIComponent(data.slice("cat:prods:".length));
        const catalog = await getCatalog(shopId);
        const group   = catalog.find(c => c.category === cat);
        if (!group || !group.items.length) {
            return edit(`📭 <b>${cat}</b> — mahsulot yo'q`, categoryActionsKeyboard(cat));
        }
        const lines = group.items.map((p, i) =>
            `${i+1}. ${p.name} — <b>${formatMoney(p.price)}</b> so'm`
        ).join("\n");
        return edit(`${group.emoji} <b>${cat}</b>\n\n${lines}`, categoryActionsKeyboard(cat));
    }

    // ── KATEGORIYA TAHRIRLASH ─────────────────────────────────────────────────
    if (data.startsWith("cat:edit_cat:")) {
        const cat = decodeURIComponent(data.slice("cat:edit_cat:".length));
        if (r) {
            await r.set(stepKey, "edit_cat_name", "EX", 300);
            await r.set(dataKey, JSON.stringify({ category: cat }), "EX", 300);
        }
        return edit(
            `✏️ <b>"${cat}"</b> nomini o'zgartiring:\n\nYangi nom yozing:`,
            { inline_keyboard: [[{ text: "❌ Bekor", callback_data: `cat:prods:${encodeURIComponent(cat)}` }]] }
        );
    }

    // ── KATEGORIYA O'CHIRISH — TASDIQLASH ────────────────────────────────────
    if (data.startsWith("cat:del_cat:")) {
        const cat = decodeURIComponent(data.slice("cat:del_cat:".length));
        const cnt = await Product.countDocuments({ shopId, category: cat });
        return edit(
            `🗑 <b>"${cat}"</b> kategoriyasini o'chirmoqchimisiz?\n\nIchida ${cnt} ta mahsulot bor — barchasi o'chadi!`,
            confirmKeyboard(`cat:del_cat_ok:${encodeURIComponent(cat)}`, "cat:list")
        );
    }
    if (data.startsWith("cat:del_cat_ok:")) {
        const cat = decodeURIComponent(data.slice("cat:del_cat_ok:".length));
        const n = await deleteCategory(shopId, cat);
        return edit(`✅ <b>"${cat}"</b> o'chirildi (${n} ta mahsulot)`, catalogMainKeyboard());
    }

    // ── MAHSULOT QO'SHISH ────────────────────────────────────────────────────
    if (data.startsWith("cat:add_prod:")) {
        const cat = decodeURIComponent(data.slice("cat:add_prod:".length));
        if (r) {
            await r.set(stepKey, "new_prod_name", "EX", 300);
            await r.set(dataKey, JSON.stringify({ category: cat }), "EX", 300);
        }
        return edit(
            `➕ <b>${cat}</b> — yangi mahsulot\n\nMahsulot nomini yozing:\n<i>Masalan: Napoleon tort</i>`,
            { inline_keyboard: [[{ text: "❌ Bekor", callback_data: `cat:list` }]] }
        );
    }

    // ── MAHSULOT NARXI O'ZGARTIRISH ───────────────────────────────────────────
    if (data.startsWith("cat:edit_price:")) {
        const pid = data.slice("cat:edit_price:".length);
        const prod = await Product.findById(pid).lean();
        if (!prod) return;
        if (r) {
            await r.set(stepKey, "edit_price", "EX", 300);
            await r.set(dataKey, JSON.stringify({ productId: pid, productName: prod.name, category: prod.category }), "EX", 300);
        }
        return edit(
            `💰 <b>${prod.name}</b>\nHozirgi narx: ${formatMoney(prod.price)} so'm\n\nYangi narxni yozing:`,
            { inline_keyboard: [[{ text: "❌ Bekor", callback_data: `cat:prods:${encodeURIComponent(prod.category)}` }]] }
        );
    }

    // ── MAHSULOT O'CHIRISH ────────────────────────────────────────────────────
    if (data.startsWith("cat:del_prod:")) {
        const pid = data.slice("cat:del_prod:".length);
        const prod = await Product.findById(pid).lean();
        if (!prod) return;
        return edit(
            `🗑 <b>"${prod.name}"</b> mahsulotini o'chirmoqchimisiz?`,
            confirmKeyboard(`cat:del_prod_ok:${pid}`, `cat:prods:${encodeURIComponent(prod.category)}`)
        );
    }
    if (data.startsWith("cat:del_prod_ok:")) {
        const pid = data.slice("cat:del_prod_ok:".length);
        const prod = await Product.findById(pid).lean();
        if (!prod) return;
        await deleteProduct(shopId, pid);
        const catalog = await getCatalog(shopId);
        const group   = catalog.find(c => c.category === prod.category);
        const lines   = group?.items?.length
            ? group.items.map((p, i) => `${i+1}. ${p.name} — ${formatMoney(p.price)} so'm`).join("\n")
            : "📭 Bo'sh";
        return edit(`✅ <b>"${prod.name}"</b> o'chirildi\n\n${group?.emoji || ""} <b>${prod.category}</b>:\n${lines}`,
            categoryActionsKeyboard(prod.category));
    }

    // ── EMOJI TANLASH ─────────────────────────────────────────────────────────
    if (data.startsWith("cat:emoji:")) {
        const emoji = data.slice("cat:emoji:".length);
        let saved   = {};
        if (r) {
            const raw = await r.get(dataKey).catch(() => null);
            if (raw) saved = JSON.parse(raw);
            if (emoji !== "custom") {
                saved.emoji = emoji;
                await r.set(dataKey, JSON.stringify(saved), "EX", 300);
                await r.set(stepKey, "new_cat_done", "EX", 300);
            }
        }
        if (emoji === "custom") {
            if (r) await r.set(stepKey, "new_cat_emoji_text", "EX", 300);
            return edit("Emoji yozing (1 ta):", { inline_keyboard: [[{ text: "❌ Bekor", callback_data: "cat:list" }]] });
        }
        // Kategoriya yaratish
        const catName = saved.catName;
        if (!catName) return edit("❌ Xato: Kategoriya nomi yo'q", catalogMainKeyboard());
        // Kategoriya mavjudmi?
        const ex = await Product.findOne({ shopId, category: catName }).lean();
        if (ex) return edit(`⚠️ <b>"${catName}"</b> kategoriyasi allaqachon bor!`, catalogMainKeyboard());
        // Bo'sh kategoriya — bitta "placeholder" mahsulot kerak emas, faqat xabar
        if (r) { await r.del(stepKey); await r.del(dataKey); }
        return edit(
            `✅ <b>${emoji} ${catName}</b> kategoriyasi tayyor!\n\nEndi mahsulot qo'shing:`,
            { inline_keyboard: [
                [{ text: "➕ Mahsulot qo'shish", callback_data: `cat:add_prod:${encodeURIComponent(catName)}` }],
                [{ text: "◀️ Katalog",            callback_data: "cat:list" }],
            ]}
        );
    }
}

// ─── MATN XABAR HANDLER (step davomi) ────────────────────────────────────────
async function handleCatalogText(bot, msg, shopId, getRedis) {
    const chatId = msg.chat.id;
    const uid    = msg.from?.id;
    const text   = String(msg.text || "").trim();
    const r      = getRedis();
    if (!r) return false;

    const stepKey = CATALOG_STEP_KEY(shopId, uid);
    const dataKey = CATALOG_DATA_KEY(shopId, uid);

    const step = await r.get(stepKey).catch(() => null);
    if (!step) return false; // Bu katalog step emas

    let saved = {};
    try { const raw = await r.get(dataKey); if (raw) saved = JSON.parse(raw); } catch {}

    // ── YANGI KATEGORIYA: NOM ──────────────────────────────────────────────
    if (step === "new_cat_name") {
        saved.catName = text;
        await r.set(dataKey, JSON.stringify(saved), "EX", 300);
        await r.set(stepKey, "new_cat_emoji", "EX", 300);
        await bot.sendMessage(chatId,
            `📂 <b>${text}</b>\n\nEmoji tanlang:`,
            { parse_mode: "HTML", reply_markup: emojiKeyboard() }
        );
        return true;
    }

    // ── YANGI KATEGORIYA: EMOJI MATN ──────────────────────────────────────
    if (step === "new_cat_emoji_text") {
        const emoji = text.slice(0, 2); // birinchi emoji
        saved.emoji = emoji;
        await r.set(dataKey, JSON.stringify(saved), "EX", 300);
        await r.set(stepKey, "new_cat_done", "EX", 300);
        // Kategoriya yaratish (placeholder yo'q — kategoriya faqat mahsulot qo'shilganda yaratiladi)
        await r.del(stepKey); await r.del(dataKey);
        await bot.sendMessage(chatId,
            `✅ <b>${emoji} ${saved.catName}</b> tayyor!\n\nMahsulot qo'shish:`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                [{ text: "➕ Mahsulot qo'shish", callback_data: `cat:add_prod:${encodeURIComponent(saved.catName)}` }],
                [{ text: "◀️ Katalog",            callback_data: "cat:list" }],
            ]}}
        );
        return true;
    }

    // ── KATEGORIYA NOMI O'ZGARTIRISH ──────────────────────────────────────
    if (step === "edit_cat_name") {
        const oldName = saved.category;
        await updateCategory(shopId, oldName, { newName: text });
        await r.del(stepKey); await r.del(dataKey);
        await bot.sendMessage(chatId,
            `✅ Kategoriya: <b>"${oldName}"</b> → <b>"${text}"</b>`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                [{ text: `📋 ${text} ni ko'rish`, callback_data: `cat:prods:${encodeURIComponent(text)}` }],
            ]}}
        );
        return true;
    }

    // ── YANGI MAHSULOT: NOM ───────────────────────────────────────────────
    if (step === "new_prod_name") {
        saved.prodName = text;
        await r.set(dataKey, JSON.stringify(saved), "EX", 300);
        await r.set(stepKey, "new_prod_price", "EX", 300);
        await bot.sendMessage(chatId,
            `🏷 <b>${text}</b>\n\nNarxini yozing (so'mda):\n<i>Masalan: 140000</i>`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "❌ Bekor", callback_data: "cat:list" }]] }}
        );
        return true;
    }

    // ── YANGI MAHSULOT: NARX ─────────────────────────────────────────────
    if (step === "new_prod_price") {
        const price = parseInt(text.replace(/\s/g, ""), 10);
        if (isNaN(price) || price < 100) {
            await bot.sendMessage(chatId, "❌ Noto'g'ri narx. Raqam kiriting:");
            return true;
        }
        try {
            // Kategoriya emoji ni olish
            const catalog = await getCatalog(shopId);
            const group   = catalog.find(c => c.category === saved.category);
            await addProduct(shopId, {
                category: saved.category,
                emoji:    group?.emoji || saved.emoji || "🛍",
                name:     saved.prodName,
                price,
            });
            await r.del(stepKey); await r.del(dataKey);
            await bot.sendMessage(chatId,
                `✅ Qo'shildi!\n\n📦 <b>${saved.prodName}</b>\n💰 ${formatMoney(price)} so'm\n📂 ${saved.category}`,
                { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                    [{ text: "➕ Yana qo'shish", callback_data: `cat:add_prod:${encodeURIComponent(saved.category)}` }],
                    [{ text: "📋 Ro'yxat",        callback_data: `cat:prods:${encodeURIComponent(saved.category)}` }],
                    [{ text: "◀️ Katalog",         callback_data: "cat:list" }],
                ]}}
            );
        } catch (e) {
            await bot.sendMessage(chatId, `❌ ${e.message}`);
        }
        return true;
    }

    // ── MAHSULOT NARXI O'ZGARTIRISH ───────────────────────────────────────
    if (step === "edit_price") {
        const price = parseInt(text.replace(/\s/g, ""), 10);
        if (isNaN(price) || price < 100) {
            await bot.sendMessage(chatId, "❌ Noto'g'ri narx:");
            return true;
        }
        await updateProductPrice(shopId, saved.productId, price);
        await r.del(stepKey); await r.del(dataKey);
        await bot.sendMessage(chatId,
            `✅ <b>${saved.productName}</b>\nYangi narx: <b>${formatMoney(price)}</b> so'm`,
            { parse_mode: "HTML", reply_markup: { inline_keyboard: [
                [{ text: "◀️ Orqaga", callback_data: `cat:prods:${encodeURIComponent(saved.category)}` }],
            ]}}
        );
        return true;
    }

    return false; // Bu xabar katalog uchun emas
}

module.exports = { handleCatalogCallback, handleCatalogText, sendCatalogMenu };
