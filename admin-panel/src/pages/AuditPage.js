import { useState, useEffect, useCallback } from "react";
import { getAudit } from "../api";

const ACTION_LABELS = {
    "shop.create":   ["🟢","Do'kon yaratildi"],
    "shop.edit":     ["✏️","Tahrirlandi"],
    "shop.stop":     ["🛑","To'xtatildi"],
    "shop.activate": ["▶️","Faollashtirildi"],
    "shop.restart":  ["🔄","Bot restart"],
};

export default function AuditPage() {
    const [logs, setLogs]     = useState([]);
    const [page, setPage]     = useState(1);
    const [loading, setLoading] = useState(true);
    const limit = 20;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await getAudit({ page, limit });
            setLogs(r.data.data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [page]);

    useEffect(() => { load(); }, [load]);

    const s = {
        title:  { fontSize:24, fontWeight:700, marginBottom:4 },
        sub:    { color:"var(--muted)", fontSize:14, marginBottom:24 },
        card:   { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--radius)", overflow:"hidden" },
        th:     { padding:"14px 16px", fontSize:12, color:"var(--muted)", textTransform:"uppercase", letterSpacing:.5, textAlign:"left", borderBottom:"1px solid var(--border)", background:"var(--surface2)" },
        td:     { padding:"13px 16px", fontSize:13, borderBottom:"1px solid var(--border)", verticalAlign:"top" },
        pager:  { display:"flex", justifyContent:"center", gap:8, marginTop:16 },
        pgBtn:  (a) => ({ padding:"7px 16px", borderRadius:6, fontSize:13, background:a?"var(--gold)":"var(--surface)", color:a?"#000":"var(--text)", cursor:"pointer", border:"1px solid var(--border)" }),
        detail: { fontSize:11, color:"var(--muted)", marginTop:2 },
    };

    return (
        <div>
            <div style={s.title}>📋 Audit Log</div>
            <div style={s.sub}>Barcha admin amallari tarixi</div>

            <div style={s.card}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                        <tr>
                            <th style={s.th}>Vaqt</th>
                            <th style={s.th}>Amal</th>
                            <th style={s.th}>Do'kon</th>
                            <th style={s.th}>Admin</th>
                            <th style={s.th}>IP</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={5} style={{ ...s.td, textAlign:"center", color:"var(--muted)" }}>Yuklanmoqda...</td></tr>
                        )}
                        {!loading && logs.length === 0 && (
                            <tr><td colSpan={5} style={{ ...s.td, textAlign:"center", color:"var(--muted)" }}>Log yo'q</td></tr>
                        )}
                        {!loading && logs.map(log => {
                            const [icon, label] = ACTION_LABELS[log.action] || ["•", log.action];
                            return (
                                <tr key={log._id}>
                                    <td style={s.td} title={log.createdAt}>
                                        {log.createdAt ? new Date(log.createdAt).toLocaleString("uz") : "—"}
                                    </td>
                                    <td style={s.td}>
                                        <span style={{ marginRight:6 }}>{icon}</span>{label}
                                        {log.details && Array.isArray(log.details) && log.details.length > 0 && (
                                            <div style={s.detail}>O'zgartirildi: {log.details.join(", ")}</div>
                                        )}
                                    </td>
                                    <td style={s.td}>{log.shopName || log.shopId || "—"}</td>
                                    <td style={s.td}>{log.adminEmail}</td>
                                    <td style={s.td}>{log.ip || "—"}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div style={s.pager}>
                {page > 1 && <button style={s.pgBtn(false)} onClick={() => setPage(p=>p-1)}>← Oldingi</button>}
                <button style={s.pgBtn(true)} disabled>{page}-sahifa</button>
                {logs.length === limit && <button style={s.pgBtn(false)} onClick={() => setPage(p=>p+1)}>Keyingi →</button>}
            </div>
        </div>
    );
}
