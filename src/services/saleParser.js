// src/services/saleParser.js
// Qo'llab-quvvatlanadigan formatlar:
//
// ODDIY:
//   "Tort 140000"
//   "Tort 2ta 140000"
//   "Napoleon tort 2ta 140000, Kofe 5000"
//
// TO'LOV:
//   "Tort 140000 berdi 100000"          → nasiya 40000
//   "Tort 140000 nasiya"                → to'liq nasiya
//   "Tort 140000 berdi 100ming"         → so'z bilan
//
// TELEFON:
//   "Tort 140000 tel 901234567"
//   "Tort 140000 +998901234567"
//
// SO'Z BILAN RAQAM:
//   "Tort yuz qirq ming"
//   "Kofe besh ming, Tort bir yarim million"
//   "Pepsi ikki ta 8000"
//
// OVOZ (STT dan keyin xuddi shu parser):
//   "tort shokoladniy ikki ta yuz to'qson ming berdi yuz ming"
//
"use strict";

// ── Raqam yoki so'z → son ──────────────────────────────────────────────────────
function toNum(s) {
    if (!s) return 0;
    s = String(s).toLowerCase().trim()
        .replace(/so['`']?m/gi, "")
        .replace(/,/g, "")
        .trim();

    // Toza raqam: "140000" yoki "140 000"
    const onlyDigits = s.replace(/\s/g, "");
    if (/^\d+$/.test(onlyDigits)) return parseInt(onlyDigits, 10);

    // So'z bilan aralash
    const WORDS = {
        // O'zbek
        "bir":1, "ikki":2, "uch":3, "to'rt":4, "tört":4, "besh":5,
        "olti":6, "yetti":7, "sakkiz":8, "to'qqiz":9, "toqqiz":9, "to'qiz":9,
        "o'n":10, "on":10, "yigirma":20, "yigirta":20,
        "o'ttiz":30, "ottiz":30, "qirq":40,
        "ellik":50, "oltmish":60, "etmish":70, "sakson":80, "to'qson":90,
        "yuz":100, "ming":1_000, "million":1_000_000,
        "yarim":0.5,
        // Qisqartma
        "min":1_000, "mln":1_000_000, "mlrd":1_000_000_000,
        // Ruscha
        "один":1,"два":2,"три":3,"четыре":4,"пять":5,
        "десять":10,"двадцать":20,"сто":100,"тысяча":1_000,
        "odin":1,"dva":2,"tri":3,"chetyre":4,"pyat":5,
        "desyat":10,"sto":100,"tysyacha":1_000,
    };

    let result = 0, current = 0;
    for (const p of s.split(/\s+/)) {
        const clean = p.replace(/[^\wа-яёА-ЯЁ']/g, "");
        if (!clean) continue;

        // Raqam qismi
        const dig = clean.replace(/\D/g, "");
        if (dig && /^\d/.test(clean)) {
            current += parseInt(dig, 10);
            continue;
        }

        const w = WORDS[clean];
        if (w === undefined) continue;

        if (w === 0.5) {           // "yarim" — yarmi
            current += 0.5;
        } else if (w >= 1_000_000) {
            result += (current || 1) * w; current = 0;
        } else if (w >= 1_000) {
            result += (current || 1) * w; current = 0;
        } else if (w >= 100) {
            current = (current || 1) * w;
        } else {
            current += w;
        }
    }
    return Math.round(result + current);
}

// ── Telefonni olish ────────────────────────────────────────────────────────────
function extractTel(text) {
    const m = text.match(
        /(?:tel(?:efon)?[\s:]*)?(\+?998\d{9}|\b0\d{9}\b|\b\d{9}\b)/i
    );
    return m ? m[1].replace(/\D/g, "").replace(/^0/, "998") : null;
}

// ── Asosiy parser ──────────────────────────────────────────────────────────────
function parseSaleText(raw) {
    if (!raw?.trim()) return null;

    const results = [];

    // Vergul, nuqtali vergul yoki yangi qator bo'yicha bo'laklarga ajratamiz
    const parts = String(raw).split(/[,;\n]+/);

    for (let part of parts) {
        part = part.trim();
        if (!part || part.length < 2) continue;

        // ── 1. Telefon ────────────────────────────────────────────────────────
        const phone  = extractTel(part);
        const noTel  = part.replace(
            /(?:tel(?:efon)?[\s:]*)?(\+?998\d{9}|\b0\d{9}\b|\b\d{9}\b)/gi, " "
        ).trim();

        // ── 2. "berdi" → to'langan summa ─────────────────────────────────────
        let paid = null;
        const berdiRx = /\b(?:berdi|toladi|t['`]oladi|to['`]ladi)\s+([\d\s]+(?:ming|min|mln|million)?)/i;
        const berdiM  = noTel.match(berdiRx);
        if (berdiM) paid = toNum(berdiM[1]);

        // ── 3. "nasiya" / "qarz" ──────────────────────────────────────────────
        const isNasiya = /\b(?:nasiya|qarz|kredit)\b/i.test(noTel);
        if (isNasiya) paid = 0;

        // ── 4. Matnni tozalaymiz ──────────────────────────────────────────────
        const clean = noTel
            .replace(berdiRx, " ")
            .replace(/\b(?:nasiya|qarz|kredit)\b/gi, " ")
            .replace(/\s+/g, " ").trim();

        // ── 5. Miqdor (qty): "2ta", "3 dona", "x2" ────────────────────────────
        let qty = 1;
        const qtyRxs = [
            /\b(\d+)\s*(?:ta|dona|x|шт|штук)\b/i,     // "2ta", "3 dona"
            /\bx\s*(\d+)\b/i,                           // "x2"
            /\b(?:ikki|uch|to'rt|tört|besh|olti|yetti|sakkiz|to'qqiz|toqqiz|o'n|on|yigirma)\s*(?:ta|dona)?\b/i,
        ];
        for (const rx of qtyRxs) {
            const m = clean.match(rx);
            if (m) {
                // So'z bilan: "ikki ta" → 2
                if (/[a-zа-яё']/i.test(m[0]) && !/^\d/.test(m[0])) {
                    qty = toNum(m[0].replace(/ta|dona/gi, "").trim()) || qty;
                } else {
                    qty = Math.max(1, parseInt(m[1], 10));
                }
                break;
            }
        }

        // ── 6. Narxni topamiz ─────────────────────────────────────────────────
        // Barcha raqamli ifodalarni topamiz
        const numRx  = /\d[\d\s]*(?:ming|min|mln|million)?/gi;
        const nums   = [...clean.matchAll(numRx)].map(m => ({
            raw:   m[0].trim(),
            value: toNum(m[0]),
            idx:   m.index,
        })).filter(n => n.value >= 100); // 100 so'mdan past narx emas

        if (!nums.length) {
            // So'z bilan narx: "Tort yuz qirq ming" yoki "Napoleon ikki ta yuz qirq ming"
            // Strategiya: so'nggi so'z-raqam bloklarini narx sifatida olish
            // "Napoleon" = nom, "ikki ta" = qty, "yuz qirq ming" = narx

            // Miqdor so'z bilan: "ikki ta", "uch dona"
            const NUMS_UZ = {"bir":1,"ikki":2,"uch":3,"to'rt":4,"tört":4,"besh":5,"olti":6,"yetti":7,"sakkiz":8,"to'qqiz":9,"toqqiz":9,"o'n":10,"on":10,"yigirma":20};
            const qtyWordRx = /(bir|ikki|uch|to['`]rt|tört|besh|olti|yetti|sakkiz|to['`]qqiz|toqqiz|o['`]n|on|yigirma)\s*(?:ta|dona)?/i;
            const qtyWM = clean.match(qtyWordRx);
            if (qtyWM) {
                qty = NUMS_UZ[qtyWM[1].toLowerCase()] || qty;
            }

            // Narx so'zlari: "yuz qirq ming", "besh ming" va hokazo
            const priceWordRx = /\b(\d+|bir|ikki|uch|to['`]rt|tört|besh|olti|yetti|sakkiz|to['`]qqiz|toqqiz|o['`]n|on|yigirma|o['`]ttiz|qirq|ellik|oltmish|etmish|sakson|to['`]qson|yuz|ming|million|yarim|min|mln)(?:\s+(?:\d+|bir|ikki|uch|to['`]rt|tört|besh|olti|yetti|sakkiz|to['`]qqiz|o['`]n|on|yigirma|o['`]ttiz|qirq|ellik|yuz|ming|million|min|mln))*\b/gi;
            const priceBlocks = [...clean.matchAll(priceWordRx)];

            // Oxirgi blok narx
            if (priceBlocks.length) {
                const lastBlock = priceBlocks[priceBlocks.length - 1];
                const price     = toNum(lastBlock[0]);
                if (price >= 100) {
                    // Nom: narx bloki va qty bloki olib tashlangach qolgan qism
                    let nameRaw = clean
                        .slice(0, lastBlock.index)
                        .replace(qtyWordRx, "")
                        .replace(/\s+/g, " ").trim();
                    if (!nameRaw) nameRaw = "Mahsulot";
                    const lineTotal = price * qty;
                    const paidAmt   = paid !== null ? Math.min(paid, lineTotal) : lineTotal;
                    results.push({ name: cleanName(nameRaw) || "Mahsulot", qty, price, paid: paidAmt, phone });
                }
            }
            continue;
        }

        // Oxirgi katta raqam = narx
        const priceObj = nums[nums.length - 1];
        const price    = priceObj.value;
        if (!price) continue;

        // ── 7. Nomni ajratamiz ────────────────────────────────────────────────
        let nameRaw = clean
            .slice(0, priceObj.idx)                         // narxdan oldingi qism
            .replace(/\b\d+\s*(?:ta|dona|x|шт|штук)\b/gi, "") // qty raqamini olib tashlash
            .replace(/\s+/g, " ").trim();

        // Agar nom bo'sh bo'lsa — raqamlar orasidagi birinchisi qty, keyingisi narx
        if (!nameRaw && nums.length >= 2) {
            qty     = Math.max(1, nums[0].value);
            nameRaw = "Mahsulot";
        }

        const name = cleanName(nameRaw) || "Mahsulot";
        const lineTotal = price * qty;
        const paidAmt   = paid !== null ? Math.min(paid, lineTotal) : lineTotal;

        results.push({ name, qty, price, paid: paidAmt, phone });
    }

    return results.length ? results : null;
}

// ── Nomni tozalash ─────────────────────────────────────────────────────────────
function cleanName(s) {
    return String(s || "")
        .replace(/\b(?:ta|dona|x|шт|штук)\b/gi, "")
        .replace(/\b(?:berdi|toladi|nasiya|qarz|tel|telefon)\b/gi, "")
        .replace(/[+\d]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

// ── Telefonni items dan olish ──────────────────────────────────────────────────
function extractPhone(items) {
    return items?.find(i => i.phone)?.phone || null;
}

module.exports = { parseSaleText, extractPhone, toNum };
