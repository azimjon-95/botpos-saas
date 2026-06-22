function parseSaleText(text) {
    if (!text) return null;
    const items = [];
    const parts = text.split(/[,\n]/);
    for (const part of parts) {
        const p = part.trim();
        if (!p) continue;
        const nums = p.match(/\d[\d\s]*/g);
        if (!nums) continue;
        const price = parseInt(nums[nums.length - 1].replace(/\s/g, ""), 10);
        if (!price || price < 100) continue;
        const qty  = nums.length > 1 ? parseInt(nums[0], 10) || 1 : 1;
        const name = p.replace(/\d[\d\s]*/g, "").replace(/[xX]/g, "").trim() || "Mahsulot";
        items.push({ name, qty, price });
    }
    return items.length > 0 ? items : null;
}
module.exports = { parseSaleText };
