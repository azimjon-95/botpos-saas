// src/services/saleParser.js — v3
// Og'irlik (kg, gr) va miqdor (ta, dona) qo'llab-quvvatlaydi
//
// FORMATLAR:
//   "Un 1.2 kg 8000"           → Un 1.2 kg × 9,600
//   "Guruch 2.5 kg 7500"       → Guruch 2.5 kg × 18,750
//   "Go'sht 850 gr 45000"      → Go'sht 0.85 kg × 38,250
//   "Un yarim kg 8000"         → Un 0.5 kg × 4,000
//   "Un bir koma ikki kg 8000" → Un 1.2 kg × 9,600
//   "Tort 2ta 140000"          → Tort × 2 × 280,000
//   "Tort 140000 nasiya"       → Tort × 1 nasiya
//   "Un 1.2 kg 8000, Tort 2ta 140000"  → ikkisi birga
"use strict";

// ── So'z → raqam ─────────────────────────────────────────────────────────────
const WORDS = {
  // O'zbek
  "bir":1, "ikki":2, "uch":3, "to'rt":4, "tört":4, "besh":5,
  "olti":6, "yetti":7, "sakkiz":8, "to'qqiz":9, "toqqiz":9, "to'qiz":9,
  "o'n":10, "on":10, "yigirma":20, "yigirta":20,
  "o'ttiz":30, "ottiz":30, "qirq":40,
  "ellik":50, "oltmish":60, "etmish":70, "sakson":80, "to'qson":90,
  "yuz":100, "ming":1000, "million":1000000,
  "yarim":0.5, "chorak":0.25,
  // Qisqartma
  "min":1000, "mln":1000000,
  // Ruscha
  "odin":1,"dva":2,"tri":3,"chetyre":4,"pyat":5,
  "desyat":10,"sto":100,"tysyacha":1000,
};

function toNum(s) {
  if (!s) return 0;
  s = String(s).toLowerCase().trim()
      .replace(/so['`]?m/gi,"").replace(/,/g,"").trim();

  // Toza raqam: "1.2", "140000", "140 000"
  const clean = s.replace(/\s/g,"");
  if (/^\d+(\.\d+)?$/.test(clean)) return parseFloat(clean);

  // "1,2" → "1.2" (Yevropa format)
  if (/^\d+[,]\d+$/.test(s.trim())) return parseFloat(s.trim().replace(",","."));

  // So'z bilan: "bir koma ikki" → 1.2
  s = s.replace(/\bkoma\b/g,".").replace(/\bnuqta\b/g,".");

  let result=0, current=0, hasDot=false, dotPart="";
  for (const p of s.split(/\s+/)) {
    const cl = p.replace(/[^\wа-яёА-ЯЁ'.]/g,"");
    if (!cl) continue;
    // Float: "1.2"
    if (/^\d+\.\d+$/.test(cl)) { current += parseFloat(cl); continue; }
    // Int
    const dig = cl.replace(/\D/g,"");
    if (dig && /^\d/.test(cl)) { current += parseInt(dig,10); continue; }
    const w = WORDS[cl];
    if (w===undefined) continue;
    if (w===0.5||w===0.25) { current+=w; }
    else if (w>=1000000) { result+=(current||1)*w; current=0; }
    else if (w>=1000)    { result+=(current||1)*w; current=0; }
    else if (w>=100)     { current=(current||1)*w; }
    else                 { current+=w; }
  }
  return Math.round((result+current)*1000)/1000;
}

// ── Og'irlik → kg ga o'girish ─────────────────────────────────────────────────
function parseWeight(s) {
  const isGram = /\b(?:gramm?|gr|г)\b/i.test(s);
  const isKg   = /\b(?:kilo(?:gramm?)?|кг|\bkg\b)\b/i.test(s);
  if (!isGram && !isKg) return null;

  const unitRx = isGram
    ? /\b(?:gramm?|gr|г)\b/i
    : /\b(?:kilo(?:gramm?)?|кг|kg)\b/i;
  const um = s.match(unitRx);
  if (!um) return null;

  const before   = s.slice(0, um.index).trim();
  const afterUnit = s.slice(um.index + um[0].length).trim();

  // "X koma Y" → "X.Y" float
  function fixKoma(str) {
    return str.replace(/(\w+)\s+koma\s+(\w+)/gi, (_, a, b) => {
      const va = toNum(a), vb = parseInt(b)||toNum(b);
      if (va>0 && vb>=0 && vb<10) return `${va}.${vb}`;
      return str;
    });
  }

  // Nomni va og'irlik qiymatini before dan ajratamiz
  const NUM_WORDS = /\b(bir|ikki|uch|to['`\u2018\u2019]rt|tört|besh|olti|yetti|sakkiz|to['`\u2018\u2019]qqiz|toqqiz|o['`\u2018\u2019]n|on|yigirma|o['`\u2018\u2019]ttiz|ottiz|qirq|ellik|oltmish|etmish|sakson|to['`\u2018\u2019]qson|yuz|yarim|chorak)\b/i;

  // Oxirgi raqam (digit) bormi?
  // "X koma Y" → "X.Y" before da ham qo'llaymiz
  const beforeFixed = fixKoma(before).replace(/\bnuqta\b/gi,".");
  const digitM = beforeFixed.match(/(\d[\d.,\s]*)$/);
  let weightVal = 0, namePart = before;

  if (digitM) {
    weightVal = parseFloat(digitM[1].replace(/\s/g,"").replace(",","."));
    namePart  = beforeFixed.slice(0, digitM.index).trim();
  } else {
    // So'z bilan: birinchi raqam-so'z topilguncha nom, qolgani og'irlik
    const words   = before.split(/\s+/);
    let nameEnd   = 0;
    for (let i=0;i<words.length;i++) {
      if (NUM_WORDS.test(words[i])) { nameEnd=i; break; }
      nameEnd = i+1;
    }
    namePart = words.slice(0,nameEnd).join(" ");
    let weightStr = fixKoma(words.slice(nameEnd).join(" ")).replace(/koma/gi,".");
    weightVal = toNum(weightStr);
  }

  if (!weightVal || weightVal<=0) return null;
  const kg = isGram ? weightVal/1000 : weightVal;
  return {
    kg:          Math.round(kg*1000)/1000,
    display:     isGram ? `${weightVal} gr` : `${weightVal} kg`,
    beforeNum:   namePart,
    afterUnit:   afterUnit,
  };
}


// ── Telefon ───────────────────────────────────────────────────────────────────
function extractTel(text) {
  const m = text.match(/(?:tel(?:efon)?[\s:]*)?(\+?998\d{9}|\b0\d{9}\b|\b\d{9}\b)/i);
  return m ? m[1].replace(/\D/g,"").replace(/^0/,"998") : null;
}

// ── Nom tozalash ──────────────────────────────────────────────────────────────
function cleanName(s) {
  return String(s||"")
    .replace(/\b(?:ta|dona|x|кг|кило|kg|kilo|gram|gramm|gr|g)\b/gi,"")
    .replace(/\b(?:berdi|toladi|nasiya|qarz|tel|telefon)\b/gi,"")
    .replace(/[\d.,]/g,"").replace(/\s+/g," ").trim();
}

// ── Asosiy parser ─────────────────────────────────────────────────────────────
function parseSaleText(raw) {
  if (!raw?.trim()) return null;
  const results = [];

  for (let part of String(raw).split(/[,;\n]+/)) {
    part = part.trim();
    if (!part||part.length<2) continue;

    // 1. Telefon
    const phone  = extractTel(part);
    const noTel  = part.replace(/(?:tel(?:efon)?[\s:]*)?(\+?998\d{9}|\b0\d{9}\b|\b\d{9}\b)/gi," ").trim();

    // 2. berdi
    let paid = null;
    const berdiM = noTel.match(/\b(?:berdi|toladi|to['`]ladi)\s+([\d\s.,]+(?:ming|min|mln|million)?)/i);
    if (berdiM) paid = toNum(berdiM[1]);

    // 3. nasiya / qarz
    if (/\b(?:nasiya|qarz|kredit)\b/i.test(noTel)) paid = 0;

    const clean = noTel
      .replace(/\b(?:berdi|toladi|to['`]ladi)\s+[\d\s.,]+(?:ming|min|mln|million)?/gi," ")
      .replace(/\b(?:nasiya|qarz|kredit)\b/gi," ")
      .replace(/\s+/g," ").trim();

    // 4. ── OG'IRLIK TEKSHIRISH ──────────────────────────────────────────────
    const weightInfo = parseWeight(clean);
    if (weightInfo) {
      // Narx = og'irlik birligidan KEYIN kelgan qism (afterUnit)
      // Misol: "un 1.2 kg 8000" → afterUnit="8000"
      // Misol: "go'sht sakkiz yuz gramm qirq besh ming" → afterUnit="qirq besh ming"
      const afterUnit = weightInfo.afterUnit || "";

      // afterUnit dan narxni topamiz (raqam yoki so'z bilan)
      let pricePerKg = 0;

      // Raqam bor bo'lsa
      const digitPriceM = afterUnit.match(/^\s*([\d\s]+(?:ming|min|mln|million)?)/i);
      if (digitPriceM) pricePerKg = toNum(digitPriceM[1]);

      // So'z bilan bo'lsa (berdi dan oldingi qism)
      if (!pricePerKg) {
        const pricePart = afterUnit.split(/\b(?:berdi|toladi)\b/i)[0].trim();
        pricePerKg      = toNum(pricePart);
      }

      if (!pricePerKg) continue;

      const total   = Math.round(pricePerKg * weightInfo.kg);
      const name    = cleanName(weightInfo.beforeNum) || "Mahsulot";
      const paidAmt = paid!==null ? Math.min(paid,total) : total;

      results.push({
        name,
        qty:      1,
        price:    total,           // jami narx (kg * narx)
        pricePerKg,                // 1 kg narxi
        weightKg: weightInfo.kg,
        weightDisplay: weightInfo.display,
        isWeight: true,
        paid:     paidAmt,
        phone,
      });
      continue;
    }

    // 5. ── ODDIY (TA, DONA) ───────────────────────────────────────────────────
    const numRx = /\d[\d\s]*(?:ming|min|mln|million)?/gi;
    const nums  = [...clean.matchAll(numRx)]
      .map(m=>({raw:m[0].trim(), val:toNum(m[0]), idx:m.index}))
      .filter(n=>n.val>=100);

    if (!nums.length) {
      // So'z bilan narx
      const NUMSW = {"bir":1,"ikki":2,"uch":3,"to'rt":4,"besh":5,"olti":6,"yetti":7,"sakkiz":8,"to'qqiz":9,"o'n":10,"yigirma":20,"qirq":40,"ellik":50,"yuz":100,"ming":1000,"million":1000000,"yarim":0.5};
      const qtyWordRx = /\b(bir|ikki|uch|to['`]rt|besh|olti|yetti|sakkiz|to['`]qqiz|o['`]n|yigirma)\s*(?:ta|dona)?\b/i;
      const qtyWM = clean.match(qtyWordRx);
      let qty = qtyWM ? (NUMSW[qtyWM[1].toLowerCase()]||1) : 1;

      const priceWordRx = /\b(\d+(?:\.\d+)?|bir|ikki|uch|to['`]rt|besh|olti|yetti|sakkiz|to['`]qqiz|o['`]n|yigirma|o['`]ttiz|qirq|ellik|oltmish|etmish|sakson|to['`]qson|yuz|ming|million|yarim|min|mln)(?:\s+(?:\d+|bir|ikki|uch|to['`]rt|besh|olti|yetti|o['`]n|yigirma|qirq|yuz|ming|million|min|mln))*\b/gi;
      const blocks = [...clean.matchAll(priceWordRx)];
      if (blocks.length) {
        const last  = blocks[blocks.length-1];
        const price = toNum(last[0]);
        if (price>=100) {
          const nameRaw = clean.slice(0,last.index).replace(qtyWordRx,"").trim();
          const lineTotal = price*qty;
          results.push({
            name: cleanName(nameRaw)||"Mahsulot",
            qty, price, paid: paid!==null?Math.min(paid,lineTotal):lineTotal, phone
          });
        }
      }
      continue;
    }

    const priceObj = nums[nums.length-1];
    const price    = priceObj.val;
    if (!price) continue;

    // qty
    let qty=1;
    const qtyM = clean.match(/\b(\d+)\s*(?:ta|dona|x|шт|штук)\b/i);
    if (qtyM) qty = Math.max(1,parseInt(qtyM[1],10));
    else if (nums.length>=2) qty = Math.max(1,Math.round(nums[0].val));

    let nameRaw = clean.slice(0,priceObj.idx)
      .replace(/\b\d+\s*(?:ta|dona|x|шт)\b/gi,"")
      .replace(/\s+/g," ").trim();
    if (!nameRaw&&nums.length>=2) { qty=Math.max(1,Math.round(nums[0].val)); nameRaw="Mahsulot"; }

    const lineTotal = price*qty;
    results.push({
      name:  cleanName(nameRaw)||"Mahsulot",
      qty, price,
      paid:  paid!==null?Math.min(paid,lineTotal):lineTotal,
      phone,
    });
  }

  return results.length ? results : null;
}

function extractPhone(items) {
  return items?.find(i=>i.phone)?.phone||null;
}

// ── Sotuv matnini formatlash (bot uchun) ─────────────────────────────────────
function formatSaleItem(it) {
  if (it.isWeight) {
    return `${it.name} ${it.weightDisplay} (${it.pricePerKg?.toLocaleString?.()}/kg) = ${it.price?.toLocaleString?.()}`;
  }
  return `${it.name} ×${it.qty} × ${it.price?.toLocaleString?.()} = ${(it.qty*it.price)?.toLocaleString?.()}`;
}

module.exports = { parseSaleText, extractPhone, toNum, formatSaleItem };
