import { useState, useEffect } from "react";
import { getStats, getBotStatus } from "../api";

function StatCard({ icon, label, value, color }) {
    const colors = { gold:"var(--gold)", green:"var(--green)", blue:"var(--blue)", red:"var(--red)", purple:"var(--purple)" };
    const c = colors[color] || "var(--text)";
    return (
        <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:"20px 24px", display:"flex", flexDirection:"column", gap:8 }}>
            <div style={{ fontSize:22 }}>{icon}</div>
            <div style={{ fontSize:12, color:"var(--muted)", textTransform:"uppercase", letterSpacing:.5 }}>{label}</div>
            <div style={{ fontSize:28, fontWeight:700, color:c }}>{value ?? "—"}</div>
        </div>
    );
}

function PlanBadge({ plan }) {
    const map = { starter:["#64748b","Starter"], pro:["var(--blue)","Pro"], business:["var(--gold)","Business"] };
    const [color, label] = map[plan] || ["#64748b", plan];
    return <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:`${color}22`, color, fontWeight:600 }}>{label}</span>;
}

export default function Dashboard() {
    const [stats, setStats]   = useState(null);
    const [bots,  setBots]    = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([getStats(), getBotStatus()])
            .then(([s, b]) => { setStats(s.data.data); setBots(b.data.data || []); })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    const s = {
        title:   { fontSize:24, fontWeight:700, marginBottom:4 },
        sub:     { color:"var(--muted)", fontSize:14, marginBottom:28 },
        grid:    { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:16, marginBottom:32 },
        section: { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", padding:24 },
        th:      { color:"var(--muted)", fontSize:12, textTransform:"uppercase", letterSpacing:.5, padding:"0 0 12px", textAlign:"left" },
        td:      { padding:"10px 0", borderTop:"1px solid var(--border)", fontSize:14 },
        badge:   (on) => ({ display:"inline-block", width:8, height:8, borderRadius:"50%", background: on ? "var(--green)" : "var(--red)", marginRight:6 }),
    };

    if (loading) return <div style={{ color:"var(--muted)", padding:40, textAlign:"center" }}>Yuklanmoqda...</div>;

    return (
        <div>
            <div style={s.title}>📊 Dashboard</div>
            <div style={s.sub}>BOT·POS SaaS umumiy ko'rsatkichlari</div>

            <div style={s.grid}>
                <StatCard icon="🏪" label="Jami do'konlar"   value={stats?.shops?.total}   color="blue" />
                <StatCard icon="✅" label="Faol do'konlar"    value={stats?.shops?.active}  color="green" />
                <StatCard icon="🛑" label="To'xtatilgan"      value={stats?.shops?.stopped} color="red" />
                <StatCard icon="🤖" label="Ishlab turgan bot" value={stats?.botsRunning}    color="gold" />
                <StatCard icon="⭐" label="Starter"           value={stats?.plans?.starter} color="purple" />
                <StatCard icon="💎" label="Pro"               value={stats?.plans?.pro}     color="blue" />
                <StatCard icon="🏆" label="Business"          value={stats?.plans?.business} color="gold" />
            </div>

            <div style={s.section}>
                <div style={{ fontSize:16, fontWeight:600, marginBottom:16 }}>🤖 Bot holatlari</div>
                {bots.length === 0
                    ? <div style={{ color:"var(--muted)", fontSize:14 }}>Hozircha ishlab turgan bot yo'q</div>
                    : (
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead>
                                <tr>
                                    <th style={s.th}>Do'kon</th>
                                    <th style={s.th}>Asosiy bot</th>
                                    <th style={s.th}>Mijoz boti</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bots.map(b => (
                                    <tr key={b.shopId}>
                                        <td style={s.td}>{b.shopName || b.shopId}</td>
                                        <td style={s.td}>
                                            <span style={s.badge(b.botActive)}/>
                                            {b.botActive ? "Aktiv" : "Nofaol"}
                                        </td>
                                        <td style={s.td}>
                                            <span style={s.badge(b.customerBotActive)}/>
                                            {b.customerBotActive ? "Aktiv" : "Yo'q"}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                }
            </div>
        </div>
    );
}
