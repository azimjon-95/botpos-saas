import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage   from "./pages/LoginPage";
import Dashboard   from "./pages/Dashboard";
import ShopList    from "./pages/ShopList";
import ShopCreate  from "./pages/ShopCreate";
import ShopDetail  from "./pages/ShopDetail";
import AuditPage   from "./pages/AuditPage";
import Layout      from "./components/Layout";

function isAuthed() { return !!localStorage.getItem("admin_token"); }

function Protected({ children }) {
    if (!isAuthed()) return <Navigate to="/login" replace />;
    return children;
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<Protected><Layout /></Protected>}>
                    <Route index element={<Dashboard />} />
                    <Route path="shops" element={<ShopList />} />
                    <Route path="shops/new" element={<ShopCreate />} />
                    <Route path="shops/:id" element={<ShopDetail />} />
                    <Route path="audit" element={<AuditPage />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
