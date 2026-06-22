const jwt = require("jsonwebtoken");
const { ADMIN_JWT_SECRET } = require("../config");

function adminAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
        return res.status(401).json({ ok: false, error: "Token kerak" });
    }
    try {
        const payload = jwt.verify(auth.slice(7), ADMIN_JWT_SECRET);
        req.adminEmail = payload.email;
        next();
    } catch {
        return res.status(401).json({ ok: false, error: "Token noto'g'ri" });
    }
}

module.exports = { adminAuth };
