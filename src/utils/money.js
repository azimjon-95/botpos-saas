function formatMoney(n) {
    return Number(n || 0).toLocaleString("uz-UZ");
}
module.exports = { formatMoney };
