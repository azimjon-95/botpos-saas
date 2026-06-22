import { Outlet, NavLink, useNavigate } from "react-router-dom";

export default function Layout() {
    const nav = useNavigate();
    function logout() {
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_refresh");
        nav("/login");
    }
    const s = {
        layout:  { display:"flex", minHeight:"100vh" },
        sidebar: { width:220, minHeight:"100vh", background:"var(--surface)", borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", padding:"24px 0", position:"sticky", top:0 },
        logo:    { display:"flex", alignItems:"center", gap:8, padding:"0 20px 24px", borderBottom:"1px solid var(--border)", marginBottom:16 },
        dot:     { width:8, height:8, borderRadius:"50%", background:"var(--gold)" },
        name:    { fontWeight:700, fontSize:16 },
        badge:   { fontSize:10, background:"rgba(247,201,72,.15)", color:"var(--gold)", borderRadius:4, padding:"2px 6px" },
        nav:     { flex:1, display:"flex", flexDirection:"column", gap:4, padding:"0 12px" },
        logout:  { margin:"0 12px", padding:"10px 12px", borderRadius:8, background:"rgba(248,113,113,.1)", color:"var(--red)", fontSize:14, textAlign:"left", cursor:"pointer" },
        main:    { flex:1, padding:32, overflowY:"auto" },
    };
    const linkStyle = ({ isActive }) => ({
        display:"flex", alignItems:"center", gap:8,
        padding:"10px 12px", borderRadius:8, fontSize:14,
        color: isActive ? "var(--gold)" : "var(--muted)",
        background: isActive ? "rgba(255,255,255,.06)" : "transparent",
        textDecoration:"none",
    });
    return (
        <div style={s.layout}>
            <aside style={s.sidebar}>
                <div style={s.logo}>
                    <span style={s.dot}/><span style={s.name}>BOT·POS</span><span style={s.badge}>Admin</span>
                </div>
                <nav style={s.nav}>
                    <NavLink to="/" end style={linkStyle}>📊 Dashboard</NavLink>
                    <NavLink to="/shops" style={linkStyle}>🏪 Do'konlar</NavLink>
                    <NavLink to="/audit" style={linkStyle}>📋 Audit Log</NavLink>
                </nav>
                <button style={s.logout} onClick={logout}>🚪 Chiqish</button>
            </aside>
            <main style={s.main}><Outlet /></main>
        </div>
    );
}
