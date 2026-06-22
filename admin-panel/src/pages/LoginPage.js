import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api";

export default function LoginPage() {
    const [email, setEmail]       = useState("");
    const [password, setPassword] = useState("");
    const [err, setErr]           = useState("");
    const [loading, setLoading]   = useState(false);
    const nav = useNavigate();

    async function handleSubmit(e) {
        e.preventDefault();
        setErr(""); setLoading(true);
        try {
            const res = await login(email, password);
            localStorage.setItem("admin_token",   res.data.data.token);
            localStorage.setItem("admin_refresh",  res.data.data.refresh);
            nav("/");
        } catch (e) {
            setErr(typeof e === "string" ? e : "Login xato");
        } finally { setLoading(false); }
    }

    const css = {
        wrap:  { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg)" },
        card:  { width:360, background:"var(--surface)", borderRadius:"var(--radius)", padding:36, border:"1px solid var(--border)" },
        title: { fontSize:22, fontWeight:700, marginBottom:8, textAlign:"center" },
        sub:   { color:"var(--muted)", fontSize:13, textAlign:"center", marginBottom:32 },
        label: { display:"block", fontSize:12, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:.5 },
        inp:   { width:"100%", padding:"11px 14px", borderRadius:8, background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14, marginBottom:16 },
        btn:   { width:"100%", padding:"13px", borderRadius:8, background:"var(--gold)", color:"#000", fontWeight:700, fontSize:15, cursor:"pointer", marginTop:8 },
        err:   { color:"var(--red)", fontSize:13, marginTop:8, textAlign:"center" },
        logo:  { textAlign:"center", marginBottom:28 },
        dot:   { display:"inline-block", width:12, height:12, borderRadius:"50%", background:"var(--gold)", marginRight:8, verticalAlign:"middle" },
    };

    return (
        <div style={css.wrap}>
            <div style={css.card}>
                <div style={css.logo}><span style={css.dot}/><b>BOT·POS</b> Admin</div>
                <div style={css.title}>Kirish</div>
                <div style={css.sub}>Faqat super admin uchun</div>
                <form onSubmit={handleSubmit}>
                    <label style={css.label}>Email</label>
                    <input style={css.inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@botpos.uz" required />
                    <label style={css.label}>Parol</label>
                    <input style={css.inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required />
                    <button style={css.btn} disabled={loading}>{loading ? "Kirmoqda..." : "Kirish"}</button>
                    {err && <div style={css.err}>{err}</div>}
                </form>
            </div>
        </div>
    );
}
