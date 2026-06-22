import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getShop, updateShop, toggleShop, restartBot } from "../api";

export default function ShopDetail() {
    const { id } = useParams();
    const nav    = useNavigate();
    const [shop, setShop]     = useState(null);
    const [form, setForm]     = useState({});
    const [loading, setLoading]   = useState(true);
    const [saving, setSaving]     = useState(false);
    const [acting, setActing]     = useState(false);
    const [err, setErr]           = useState("");
    const [saved, setSaved]       = useState(false);
    const [editTokens, setEditTokens] = useState(false);

    useEffect(() => {
        getShop(id)
            .then(r => { setShop(r.data.data); setForm(r.data.data); })
            .catch(e => setErr(String(e)))
            .finally(() => setLoading(false));
    }, [id]);

    function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

    async function handleSave(e) {
        e.preventDefault();
        setErr(""); setSaving(true);
        try {
            const update = { ...form };
            // Tokenlar bo'sh bo'lsa yubormaymiz (o'zgartirilmagan)
            if (!editTokens) {
                delete update.botToken;
                delete update.customerBotToken;
                delete update.openaiKey;
            }
            await updateShop(id, update);
            setSaved(true); setTimeout(() => setSaved(false), 2000);
        } catch (e) { setErr(String(e)); }
        finally { setSaving(false); }
    }

    async function handleToggle() {
        if (!window.confirm(shop.isActive ? "Do'konni to'xtatmoqchimisiz?" : "Do'konni faollashtirishmoqchimisiz?")) return;
        setActing(true);
        try { await toggleShop(id); setShop(s => ({ ...s, isActive: !s.isActive })); }
        catch (e) { setErr(String(e)); }
        finally { setActing(false); }
    }

    async function handleRestart() {
        setActing(true);
        try { await restartBot(id); alert("✅ Bot restart qilindi"); }
        catch (e) { setErr(String(e)); }
        finally { setActing(false); }
    }

    const s = {
        header:  { display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:28 },
        title:   { fontSize:24, fontWeight:700 },
        sub:     { color:"var(--muted)", fontSize:14, marginTop:4 },
        btns:    { display:"flex", gap:10 },
        actionBtn:(color) => ({ padding:"9px 18px", borderRadius:8, background:`${color}22`, color, fontSize:13, fontWeight:600, cursor:"pointer", border:`1px solid ${color}33` }),
        card:    { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:28, marginBottom:20 },
        shead:   { fontSize:16, fontWeight:600, marginBottom:20, paddingBottom:12, borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between" },
        grid:    { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 },
        row:     { marginBottom:0 },
        label:   { display:"block", fontSize:12, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:.5 },
        inp:     { width:"100%", padding:"10px 14px", borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14 },
        sel:     { width:"100%", padding:"10px 14px", borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14 },
        saveRow: { display:"flex", gap:12, alignItems:"center", marginTop:8 },
        saveBtn: { padding:"11px 28px", borderRadius:8, background:"var(--gold)", color:"#000", fontWeight:700, fontSize:14, cursor:"pointer" },
        backBtn: { padding:"11px 18px", borderRadius:8, background:"var(--surface2)", color:"var(--text)", fontSize:14, cursor:"pointer", border:"1px solid var(--border)" },
        err:     { color:"var(--red)", fontSize:13, padding:"10px 14px", background:"rgba(248,113,113,.1)", borderRadius:8, marginBottom:16 },
        ok:      { color:"var(--green)", fontSize:13 },
        dot:     (on) => ({ display:"inline-block", width:10, height:10, borderRadius:"50%", background: on?"var(--green)":"var(--red)", marginRight:8, verticalAlign:"middle" }),
        info:    { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12, marginBottom:20 },
        icard:   { background:"var(--surface2)", borderRadius:8, padding:"14px 16px" },
        ilab:    { fontSize:11, color:"var(--muted)", marginBottom:4, textTransform:"uppercase" },
        ival:    { fontSize:15, fontWeight:600 },
        toggleChk: { display:"flex", alignItems:"center", gap:8, fontSize:13, color:"var(--muted)", cursor:"pointer", marginTop:8 },
    };

    if (loading) return <div style={{ color:"var(--muted)", padding:40, textAlign:"center" }}>Yuklanmoqda...</div>;
    if (!shop) return <div style={{ color:"var(--red)", padding:40 }}>Do'kon topilmadi</div>;

    return (
        <div style={{ maxWidth:760 }}>
            <div style={s.header}>
                <div>
                    <div style={s.title}>
                        <span style={s.dot(shop.isActive)} />{shop.name}
                    </div>
                    <div style={s.sub}>
                        {shop.ownerName} · {shop.phone} · {shop.plan?.toUpperCase()}
                    </div>
                </div>
                <div style={s.btns}>
                    <button style={s.actionBtn("var(--blue)")} onClick={handleRestart} disabled={acting}>🔄 Restart</button>
                    <button style={s.actionBtn(shop.isActive ? "var(--red)" : "var(--green)")}
                        onClick={handleToggle} disabled={acting}>
                        {shop.isActive ? "🛑 To'xtatish" : "▶️ Faollashtirish"}
                    </button>
                </div>
            </div>

            {/* Info kartalar */}
            <div style={s.info}>
                <div style={s.icard}><div style={s.ilab}>WebApp URL</div>
                    <div style={{ ...s.ival, fontSize:12, wordBreak:"break-all", color:"var(--blue)" }}>{shop.webappUrl || "—"}</div>
                </div>
                <div style={s.icard}><div style={s.ilab}>Yaratilgan</div>
                    <div style={s.ival}>{shop.createdAt ? new Date(shop.createdAt).toLocaleDateString("uz") : "—"}</div>
                </div>
                <div style={s.icard}><div style={s.ilab}>Guruh Chat ID</div>
                    <div style={s.ival}>{shop.groupChatId || "—"}</div>
                </div>
                <div style={s.icard}><div style={s.ilab}>Min Cashback</div>
                    <div style={s.ival}>{Number(shop.minQrPaid || 0).toLocaleString()} so'm</div>
                </div>
            </div>

            {err && <div style={s.err}>⚠️ {err}</div>}

            <form onSubmit={handleSave}>
                {/* Asosiy */}
                <div style={s.card}>
                    <div style={s.shead}>📋 Asosiy ma'lumotlar</div>
                    <div style={s.grid}>
                        {[
                            ["name","Do'kon nomi"],["ownerName","Egasi"],
                            ["phone","Telefon"],["address","Manzil"],
                        ].map(([key,label]) => (
                            <div key={key} style={s.row}>
                                <label style={s.label}>{label}</label>
                                <input style={s.inp} value={form[key]||""} onChange={e=>set(key,e.target.value)} />
                            </div>
                        ))}
                        <div style={s.row}>
                            <label style={s.label}>Tarif</label>
                            <select style={s.sel} value={form.plan||"starter"} onChange={e=>set("plan",e.target.value)}>
                                <option value="starter">⭐ Starter</option>
                                <option value="pro">💎 Pro</option>
                                <option value="business">🏆 Business</option>
                            </select>
                        </div>
                        <div style={s.row}>
                            <label style={s.label}>Bot paroli</label>
                            <input style={s.inp} value={form.botPassword||""} onChange={e=>set("botPassword",e.target.value)} />
                        </div>
                        <div style={s.row}>
                            <label style={s.label}>Min cashback (so'm)</label>
                            <input style={s.inp} type="number" value={form.minQrPaid||""} onChange={e=>set("minQrPaid",e.target.value)} />
                        </div>
                        <div style={s.row}>
                            <label style={s.label}>Admin TG ID</label>
                            <input style={s.inp} value={form.adminTgId||""} onChange={e=>set("adminTgId",e.target.value)} />
                        </div>
                    </div>
                </div>

                {/* Tokenlar */}
                <div style={s.card}>
                    <div style={s.shead}>
                        <span>🔑 Bot tokenlar <span style={{ fontSize:12, color:"var(--muted)", fontWeight:400 }}>(shifrlangan)</span></span>
                    </div>
                    <label style={s.toggleChk}>
                        <input type="checkbox" checked={editTokens} onChange={e=>setEditTokens(e.target.checked)} />
                        Tokenlarni yangilash (eski qiymatlar ko'rsatilmaydi)
                    </label>
                    {editTokens && (
                        <div style={{ ...s.grid, marginTop:16 }}>
                            {[
                                ["botToken","Asosiy bot token"],
                                ["customerBotToken","Cashback bot token"],
                                ["openaiKey","OpenAI API key"],
                                ["groupChatId","Guruh Chat ID"],
                                ["customerBotUsername","Cashback bot username"],
                                ["backupChatId","Backup Chat ID"],
                            ].map(([key,label]) => (
                                <div key={key} style={s.row}>
                                    <label style={s.label}>{label}</label>
                                    <input style={s.inp} type={key.includes("Token")||key.includes("Key")?"password":"text"}
                                        value={form[key]||""} onChange={e=>set(key,e.target.value)}
                                        placeholder={key.includes("Token")||key.includes("Key") ? "Yangi qiymat kiriting" : ""} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={s.saveRow}>
                    <button type="button" style={s.backBtn} onClick={() => nav("/shops")}>← Orqaga</button>
                    <button type="submit" style={s.saveBtn} disabled={saving}>
                        {saving ? "Saqlanmoqda..." : "💾 Saqlash"}
                    </button>
                    {saved && <span style={s.ok}>✅ Saqlandi!</span>}
                </div>
            </form>
        </div>
    );
}
