import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createShop } from "../api";

const FIELDS = [
    { key:"name",               label:"Do'kon nomi",           required:true,  placeholder:"Totli Tortlar" },
    { key:"ownerName",          label:"Egasi ismi",            required:true,  placeholder:"Azimjon Mirzo" },
    { key:"phone",              label:"Telefon",               required:true,  placeholder:"+998901234567" },
    { key:"address",            label:"Manzil",                required:false, placeholder:"Toshkent, Chilonzor" },
    { key:"botToken",           label:"Bot token (asosiy) 🔑", required:true,  placeholder:"123456:ABCDEF..." },
    { key:"groupChatId",        label:"Guruh Chat ID",         required:true,  placeholder:"-1001234567890" },
    { key:"customerBotToken",   label:"Cashback bot token",    required:false, placeholder:"654321:ZYXWV..." },
    { key:"customerBotUsername",label:"Cashback bot username", required:false, placeholder:"@totli_rewards_bot" },
    { key:"openaiKey",          label:"OpenAI API key 🔑",     required:false, placeholder:"sk-..." },
    { key:"adminTgId",          label:"Admin Telegram ID",     required:false, placeholder:"123456789" },
    { key:"bakerTgId",          label:"Tortchi TG ID",         required:false, placeholder:"987654321" },
    { key:"botPassword",        label:"Bot paroli",            required:false, placeholder:"1234" },
    { key:"minQrPaid",          label:"Min cashback summa",    required:false, placeholder:"70000" },
    { key:"backupChatId",       label:"Backup chat ID",        required:false, placeholder:"-1009876543210" },
    { key:"notes",              label:"Izoh",                  required:false, placeholder:"..." },
];

export default function ShopCreate() {
    const [form, setForm]     = useState({ plan:"starter", botPassword:"1234", minQrPaid:"70000" });
    const [loading, setLoading] = useState(false);
    const [err, setErr]         = useState("");
    const nav = useNavigate();

    function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

    async function handleSubmit(e) {
        e.preventDefault();
        setErr(""); setLoading(true);
        try {
            const res = await createShop(form);
            alert(`✅ Do'kon yaratildi!\nWebApp URL: ${res.data.data.webappUrl}`);
            nav("/shops");
        } catch (e) {
            setErr(typeof e === "string" ? e : "Xatolik yuz berdi");
        } finally { setLoading(false); }
    }

    const s = {
        wrap:  { maxWidth:680 },
        title: { fontSize:24, fontWeight:700, marginBottom:4 },
        sub:   { color:"var(--muted)", fontSize:14, marginBottom:32 },
        card:  { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:28, marginBottom:20 },
        shead: { fontSize:16, fontWeight:600, marginBottom:20, paddingBottom:12, borderBottom:"1px solid var(--border)" },
        row:   { marginBottom:18 },
        label: { display:"block", fontSize:12, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:.5 },
        req:   { color:"var(--red)", marginLeft:2 },
        inp:   { width:"100%", padding:"11px 14px", borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14 },
        sel:   { width:"100%", padding:"11px 14px", borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14 },
        hint:  { fontSize:11, color:"var(--muted)", marginTop:4 },
        btns:  { display:"flex", gap:12 },
        save:  { flex:1, padding:"13px", borderRadius:8, background:"var(--gold)", color:"#000", fontWeight:700, fontSize:15, cursor:"pointer" },
        cancel:{ padding:"13px 24px", borderRadius:8, background:"var(--surface2)", color:"var(--text)", fontSize:14, cursor:"pointer", border:"1px solid var(--border)" },
        err:   { color:"var(--red)", fontSize:13, marginBottom:16, padding:"10px 14px", background:"rgba(248,113,113,.1)", borderRadius:8 },
    };

    const mainFields  = FIELDS.slice(0, 4);
    const botFields   = FIELDS.slice(4, 9);
    const extraFields = FIELDS.slice(9);

    function renderField(f) {
        return (
            <div key={f.key} style={s.row}>
                <label style={s.label}>{f.label}{f.required && <span style={s.req}>*</span>}</label>
                <input style={s.inp} placeholder={f.placeholder} value={form[f.key] || ""}
                    onChange={e => set(f.key, e.target.value)}
                    required={f.required}
                    type={f.key.toLowerCase().includes("token") || f.key.toLowerCase().includes("key") ? "password" : "text"}
                />
                {f.key === "botToken" && <div style={s.hint}>🔒 AES-256 bilan shifrlangan saqlanadi</div>}
            </div>
        );
    }

    return (
        <div style={s.wrap}>
            <div style={s.title}>➕ Yangi do'kon qo'shish</div>
            <div style={s.sub}>TZ 5.1 bo'yicha barcha maydonlar</div>

            <form onSubmit={handleSubmit}>
                {/* Asosiy ma'lumotlar */}
                <div style={s.card}>
                    <div style={s.shead}>📋 Asosiy ma'lumotlar</div>
                    {mainFields.map(renderField)}
                </div>

                {/* Bot sozlamalari */}
                <div style={s.card}>
                    <div style={s.shead}>🤖 Bot sozlamalari <span style={{ fontSize:12, color:"var(--muted)", fontWeight:400 }}>(tokenlar shifrlangan saqlanadi)</span></div>
                    {botFields.map(renderField)}
                </div>

                {/* Qo'shimcha */}
                <div style={s.card}>
                    <div style={s.shead}>⚙️ Qo'shimcha sozlamalar</div>
                    {extraFields.map(renderField)}

                    {/* Tarif */}
                    <div style={s.row}>
                        <label style={s.label}>Tarif rejasi <span style={s.req}>*</span></label>
                        <select style={s.sel} value={form.plan || "starter"} onChange={e => set("plan", e.target.value)}>
                            <option value="starter">⭐ Starter</option>
                            <option value="pro">💎 Pro</option>
                            <option value="business">🏆 Business</option>
                        </select>
                    </div>
                </div>

                {err && <div style={s.err}>⚠️ {err}</div>}

                <div style={s.btns}>
                    <button type="button" style={s.cancel} onClick={() => nav("/shops")}>Bekor qilish</button>
                    <button type="submit" style={s.save} disabled={loading}>
                        {loading ? "Yaratilmoqda..." : "✅ Do'kon yaratish va botni ishga tushirish"}
                    </button>
                </div>
            </form>
        </div>
    );
}
