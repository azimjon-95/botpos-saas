const dayjs = require("dayjs");
const timezone = require("dayjs/plugin/timezone");
const utc = require("dayjs/plugin/utc");
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = "Asia/Tashkent";

function startOfToday() {
    return dayjs().tz(TZ).startOf("day").toDate();
}
function endOfToday() {
    return dayjs().tz(TZ).endOf("day").toDate();
}
function formatHM(date) {
    return dayjs(date).tz(TZ).format("HH:mm");
}
function formatMonthYear(date) {
    return dayjs(date).tz(TZ).format("DD.MM.YYYY");
}

module.exports = { startOfToday, endOfToday, formatHM, formatMonthYear };
