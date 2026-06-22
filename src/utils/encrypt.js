const crypto = require("crypto");
const { MASTER_ENCRYPTION_KEY } = require("../config");
const ALG = "aes-256-gcm";

function getKey() {
    if (!MASTER_ENCRYPTION_KEY || MASTER_ENCRYPTION_KEY.length < 32) {
        throw new Error("MASTER_ENCRYPTION_KEY .env da yo'q yoki qisqa (min 32 char)");
    }
    return Buffer.from(MASTER_ENCRYPTION_KEY.slice(0, 64), "hex");
}

function encrypt(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, getKey(), iv);
    let enc = cipher.update(String(text), "utf8", "hex");
    enc += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${tag}:${enc}`;
}

function decrypt(encStr) {
    if (!encStr) return "";
    const parts = encStr.split(":");
    if (parts.length !== 3) return encStr;
    const [ivHex, tagHex, enc] = parts;
    const decipher = crypto.createDecipheriv(ALG, getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    let dec = decipher.update(enc, "hex", "utf8");
    dec += decipher.final("utf8");
    return dec;
}

module.exports = { encrypt, decrypt };
