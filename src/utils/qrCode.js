// src/utils/qrCode.js
// Sotuv chekida QR kod yaratish
// Format: botpos_qr_{shopId}_{amount}_{saleId}
// Haridor cashback bot ga shu matnni yuboradi
"use strict";

const QR_PREFIX = "botpos_qr_";

// QR matn generatsiyasi (QR library kerak emas — text format)
function buildQRText(shopId, amount, saleId) {
    return `${QR_PREFIX}${shopId}_${amount}_${saleId || ""}`;
}

// QR URL — qr.io yoki telegram inline orqali
function buildQRUrl(text) {
    const encoded = encodeURIComponent(text);
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}`;
}

// Chek pastida QR ma'lumot
function buildReceiptQRBlock(shopId, amount, saleId, cashbackBotUsername) {
    const qrText = buildQRText(shopId, amount, saleId);
    const qrUrl  = buildQRUrl(qrText);

    return {
        qrText,
        qrUrl,
        instruction: cashbackBotUsername
            ? `📱 Cashback olish: @${cashbackBotUsername} ga QR kodni yuboring`
            : null,
    };
}

module.exports = { buildQRText, buildQRUrl, buildReceiptQRBlock, QR_PREFIX };
