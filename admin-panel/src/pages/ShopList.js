import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getShops, toggleShop, restartBot } from "../api";

function PlanBadge({ plan }) {
    const map = { starter:["#64748b","Starter"], pro:["var(--blue)","Pro"], business:["var(--gold)","Business"] };
    const [color, label] = map[plan] || ["#64748b", plan || "—"];
    return <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:`${color}22`, color, fontWeight:600 }}>{label}</span>;
}

export default function ShopList() {
    const [shops, setShops]   = useState([]);
    const [total, setTotal]   = useState(0);
    const [page, setPage]     = useState(1);
    const [search, setSearch] = useState("");
    const [plan, setPlan]     = useState("");
    const [loading, setLoading] = useState(true);
    const [acting, setActing]   = useState(null);
    const nav = useNavigate();
    const limit = 15;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await getShops({ page, limit, search: search||undefined, plan: plan||undefined });
            setShops(r.data.data.shops);
            setTotal(r.data.data.total);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [page, search, plan]);

    useEffect(() => { load(); }, [load]);

    async function handleToggle(id, e) {
        e.stopPropagation();
        setActing(id);
        try { await toggleShop(id); await load(); }
        catch (e) { alert(e); }
        finally { setActing(null); }
    }

    async function handleRestart(id, e) {
        e.stopPropagation();
        setActing(id);
        try { await restartBot(id); alert("✅ Bot restart qilindi"); }
        catch (e) { alert(e); }
        finally { setActing(null); }
    }

    const s = {
        header:  { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 },
        title:   { fontSize:24, fontWeight:700 },
        newBtn:  { padding:"10px 20px", borderRadius:8, background:"var(--gold)", color:"#000", fontWeight:700, fontSize:14, cursor:"pointer" },
        filters: { display:"flex", gap:12, marginBottom:20 },
        inp:     { padding:"9px 14px", borderRadius:8, background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14, flex:1 },
        sel:     { padding:"9px 14px", borderRadius:8, background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", fontSize:14 },
        table:   { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden", width:"100%" },
        th:      { padding:"14px 16px", fontSize:12, color:"var(--muted)", textTransform:"uppercase", letterSpacing:.5, textAlign:"left", borderBottom:"1px solid var(--border)", background:"var(--surface2)" },
        tr:      { cursor:"pointer", transition:"background .15s" },
        td:      { padding:"14px 16px", fontSize:14, borderBottom:"1px solid var(--border)" },
        dot:     (on) => ({ display:"inline-block", width:8, height:8, borderRadius:"50%", background: on?"var(--green)":"var(--red)", marginRight:6 }),
        btn:     (color) => ({ padding:"5px 12px", borderRadius:6, fontSize:12, fontWeight:600, background:`${color}22`, color, cursor:"pointer", marginRight:6 }),
        pager:   { display:"flex", justifyContent:"center", gap:8, marginTop:20 },
        pageBtn: (active) => ({ padding:"7px 14px", borderRadius:6, fontSize:13, background: active?"var(--gold)":"var(--surface)", color: active?"#000":"var(--text)", cursor:"pointer", border:"1px solid var(--border)" }),
    };

    const pages = Math.ceil(total / limit);

    return (
        <div>
            <div style={s.header}>
                <div>
                    <div style={s.title}>🏪 Do'konlar</div>
                    <div style={{ color:"var(--muted)", fontSize:14, marginTop:4 }}>Jami: {total} ta</div>
                </div>
                <button style={s.newBtn} onClick={() => nav("/shops/new")}>+ Yangi do'kon</button>
            </div>

            <div style={s.filters}>
                <input style={s.inp} placeholder="🔍 Dokon nomi bo'yicha qidirish..." value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }} />
                <select style={s.sel} value={plan} onChange={e => { setPlan(e.target.value); setPage(1); }}>
                    <option value="">Barcha tariflar</option>
                    <option value="starter">Starter</option>
                    <option value="pro">Pro</option>
                    <option value="business">Business</option>
                </select>
            </div>

            <div style={s.table}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                        <tr>
                            <th style={s.th}>Do'kon nomi</th>
                            <th style={s.th}>Egasi</th>
                            <th style={s.th}>Telefon</th>
                            <th style={s.th}>Tarif</th>
                            <th style={s.th}>Holat</th>
                            <th style={s.th}>Amallar</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={6} style={{ ...s.td, textAlign:"center", color:"var(--muted)" }}>Yuklanmoqda...</td></tr>
                        )}
                        {!loading && shops.length === 0 && (
                            <tr><td colSpan={6} style={{ ...s.td, textAlign:"center", color:"var(--muted)" }}>Do'konlar topilmadi</td></tr>
                        )}
                        {!loading && shops.map(shop => (
                            <tr key={shop._id} style={s.tr}
                                onClick={() => nav(`/shops/${shop._id}`)}
                                onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,.03)"}
                                onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                                <td style={s.td}>
                                    <div style={{ fontWeight:600 }}>{shop.name}</div>
                                    {shop.address && <div style={{ fontSize:12, color:"var(--muted)", marginTop:2 }}>{shop.address}</div>}
                                </td>
                                <td style={s.td}>{shop.ownerName}</td>
                                <td style={s.td}>{shop.phone}</td>
                                <td style={s.td}><PlanBadge plan={shop.plan} /></td>
                                <td style={s.td}>
                                    <span style={s.dot(shop.isActive)} />
                                    {shop.isActive ? "Faol" : "To'xtatilgan"}
                                </td>
                                <td style={s.td} onClick={e => e.stopPropagation()}>
                                    <button style={s.btn(shop.isActive?"var(--red)":"var(--green)")}
                                        disabled={acting === shop._id}
                                        onClick={e => handleToggle(shop._id, e)}>
                                        {shop.isActive ? "To'xtat" : "Faollashtir"}
                                    </button>
                                    <button style={s.btn("var(--blue)")}
                                        disabled={acting === shop._id}
                                        onClick={e => handleRestart(shop._id, e)}>
                                        🔄
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {pages > 1 && (
                <div style={s.pager}>
                    {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                        <button key={p} style={s.pageBtn(p === page)} onClick={() => setPage(p)}>{p}</button>
                    ))}
                </div>
            )}
        </div>
    );
}
