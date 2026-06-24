// src/services/saleParser.js — Mahalliy sotuv parser (AI kerak emas)
// "Tort 140000" | "Tort 2ta 140000" | "Tort x2 140000 berdi 100000 tel 901234567"
"use strict";

function toMoney(s) {
    s = String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
    s = s.replace(/so['`]?m/gi, "").trim();
    // "140ming" → 140000
    const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(min|ming|minga)$/i);
    if (m) return Math.round(Number(m[1].replace(",", ".")) * 1000);
    const digits = s.replace(/\D/g, "");
    if (!digits) return 0;
    const n = parseInt(digits, 10);
    // 1..999 → ming
    return (n >= 1 && n <= 999) ? n * 1000 : n;
}

function parseSaleText(text) {
    if (!text?.trim()) return null;
    const items = [];

    for (const part of String(text).split(/[,\n;]/)) {
        const p = part.trim();
        if (!p || p.length < 2) continue;

        // Tel raqamni olib tashlaymiz
        const noTel = p.replace(/(?:tel|telefon)?\s*\+?\d{9,12}/gi, " ").trim();

        // Berdi summasi
        let paid = null;
        const berdiMatch = noTel.match(/berdi\s+([\d\s]+(?:ming)?)/i);
        if (berdiMatch) paid = toMoney(berdiMatch[1]);
        const cleanText = noTel.replace(/berdi\s+[\d\s]+(?:ming)?/gi, "").trim();

        // Sonlar
        const nums = cleanText.match(/\d[\d\s]*(ming)?/gi) || [];
        if (!nums.length) continue;

        const lastNum  = nums[nums.length - 1];
        const price    = toMoney(lastNum);
        if (!price || price < 100) continue;

        // Qty
        let qty = 1;
        const qtyMatch = cleanText.match(/\b(\d+)\s*(?:ta|dona|x)\b/i);
        if (qtyMatch) qty = Math.max(1, parseInt(qtyMatch[1], 10));
        else if (nums.length >= 2) qty = Math.max(1, parseInt(nums[0], 10) || 1);

        // Nom — raqamlarni olib tashlagandan keyin qolgan
        let name = cleanText
            .replace(/\b\d+\s*(?:ta|dona|x)\b/gi, " ")
            .replace(new RegExp(lastNum.replace(/\s+/g, "\\s*"), "i"), " ")
            .replace(/\s+/g, " ").trim();
        if (!name || name.length < 2) name = "Mahsulot";

        items.push({
            name,
            qty,
            price,
            paid: paid !== null ? paid : qty * price,
        });
    }
    return items.length ? items : null;
}

module.exports = { parseSaleText };
