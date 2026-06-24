// src/services/saleParser.js — Kuchaytirilgan sotuv parser
// Qo'llab-quvvatlanadi:
//   "Tort 140000"
//   "Tort 2ta 140000"
//   "Tort 140000 berdi 100000"
//   "Tort 140000 berdi 100ming tel 901234567"
//   "Tort yuz qirq ming berdi yuz ming" (so'z bilan)
"use strict";

// Raqam yoki so'z → son
function toMoney(s) {
    if (!s) return 0;
    s = String(s).toLowerCase().trim().replace(/\s+/g, " ");
    s = s.replace(/so['`]?m/gi, "").trim();

    // "140 000" yoki "140000"
    const digits = s.replace(/[^\d]/g, "");
    if (digits && !s.match(/[a-zа-яёА-ЯЁ]/)) {
        const n = parseInt(digits, 10);
        return n;
    }

    // So'z bilan: "yuz qirq ming", "bir yarim million"
    const WORDS = {
        "bir":1,"ikki":2,"uch":3,"to'rt":4,"tört":4,"besh":5,
        "olti":6,"yetti":7,"sakkiz":8,"to'qqiz":9,"toqqiz":9,
        "o'n":10,"on":10,"yigirma":20,"o'ttiz":30,"qirq":40,
        "ellik":50,"oltmish":60,"etmish":70,"sakson":80,"to'qson":90,
        "yuz":100,"ming":1000,"million":1000000,
        // Ruscha
        "odin":1,"dva":2,"tri":3,"chetyre":4,"pyat":5,
        "desyat":10,"dvadtsat":20,"sto":100,"tysyacha":1000,
        // Qisqartmalar
        "min":1000,"mln":1000000,"mlrd":1000000000,
    };

    let result = 0, current = 0;
    const parts = s.split(/\s+/);
    for (const p of parts) {
        const clean = p.replace(/[^\wа-яёА-ЯЁ']/g,"");
        if (!clean) continue;
        // Raqam
        const num = parseInt(clean.replace(/[^\d]/g,""), 10);
        if (!isNaN(num) && clean.match(/^\d/)) {
            current += num;
            continue;
        }
        const w = WORDS[clean];
        if (!w) continue;
        if (w >= 1000) {
            result += (current || 1) * w;
            current = 0;
        } else if (w >= 100) {
            current = (current || 1) * w;
        } else {
            current += w;
        }
    }
    result += current;
    return result;
}

function parseSaleText(text) {
    if (!text?.trim()) return null;
    const items = [];

    for (const part of String(text).split(/[,\n;]/)) {
        const p = part.trim();
        if (!p || p.length < 2) continue;

        // Telefon raqamni saqlaymiz, lekin nomdan olib tashlaymiz
        let phone = null;
        const telMatch = p.match(/(?:tel|telefon)?\s*(\+?998\d{9}|\d{9,10})/i);
        if (telMatch) phone = telMatch[1];
        const noTel = p.replace(/(?:tel|telefon)?\s*\+?\d{9,12}/gi, " ").trim();

        // "berdi" summasi
        let paid = null;
        const berdiMatch = noTel.match(/berdi\s+([\d\s.,]+(?:ming|min|mln)?)/i);
        if (berdiMatch) paid = toMoney(berdiMatch[1]);

        // "nasiya" yoki "qarz" so'zi — paid=0
        if (/nasiya|qarz/i.test(noTel)) paid = 0;

        const cleanText = noTel
            .replace(/berdi\s+[\d\s.,]+(?:ming|min|mln)?/gi, " ")
            .replace(/nasiya|qarz/gi, " ")
            .trim();

        // Raqamlarni topamiz (narx va qty uchun)
        const numMatches = cleanText.match(/\d[\d\s]*(ming|min|mln)?/gi) || [];
        if (!numMatches.length) continue;

        const lastNum = numMatches[numMatches.length - 1];
        const price   = toMoney(lastNum);
        if (!price || price < 100) continue;

        // Qty
        let qty = 1;
        const qtyMatch = cleanText.match(/\b(\d+)\s*(?:ta|dona|x|штук|шт)\b/i);
        if (qtyMatch) qty = Math.max(1, parseInt(qtyMatch[1], 10));
        else if (numMatches.length >= 2) qty = Math.max(1, parseInt(numMatches[0], 10) || 1);

        // Nom
        let name = cleanText
            .replace(/\b\d+\s*(?:ta|dona|x|штук|шт)\b/gi, " ")
            .replace(new RegExp(lastNum.replace(/[\s.*+?^${}()|[\]\\]/g,"\\$&"), "i"), " ")
            .replace(/\s+/g, " ").trim();
        if (!name || name.length < 2) name = "Mahsulot";

        const linePrice = qty * price;
        items.push({
            name,
            qty,
            price,
            paid:  paid !== null ? Math.min(paid, linePrice) : linePrice,
            phone: phone || null,
        });
    }
    if (!items.length) return null;

    // Telefon raqamni birinchi topilgandan olish
    const phone = items.reduce((p, it) => p || it.phone, null);

    // items dan phone olib tashlaymiz (u alohida)
    const clean = items.map(({ phone: _, ...it }) => it);

    // phone ni result ga biriktirish (doSaveSale uchun)
    if (phone) clean._phone = phone;
    return clean;
}

// Phone ni alohida olish
function extractPhone(items) {
    if (!items) return null;
    for (const it of items) {
        if (it.phone) return it.phone;
    }
    return null;
}

module.exports = { parseSaleText, extractPhone };
