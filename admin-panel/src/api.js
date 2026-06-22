import axios from "axios";

const api = axios.create({
    baseURL: "/api/admin",
    timeout: 15000,
});

api.interceptors.request.use((cfg) => {
    const token = localStorage.getItem("admin_token");
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
});

api.interceptors.response.use(
    r => r,
    async (err) => {
        if (err.response?.status === 401) {
            // Refresh token bilan yangilash
            const refresh = localStorage.getItem("admin_refresh");
            if (refresh) {
                try {
                    const res = await axios.post("/api/admin/refresh", { refresh });
                    const newToken = res.data?.data?.token;
                    if (newToken) {
                        localStorage.setItem("admin_token", newToken);
                        err.config.headers.Authorization = `Bearer ${newToken}`;
                        return axios(err.config);
                    }
                } catch {}
            }
            localStorage.removeItem("admin_token");
            localStorage.removeItem("admin_refresh");
            window.location.href = "/login";
        }
        return Promise.reject(err?.response?.data?.error || err.message || "Xatolik");
    }
);

export const login  = (email, password)  => api.post("/login", { email, password });
export const getShops = (params)          => api.get("/shops", { params });
export const getShop  = (id)              => api.get(`/shops/${id}`);
export const createShop = (data)          => api.post("/shops", data);
export const updateShop = (id, data)      => api.put(`/shops/${id}`, data);
export const toggleShop = (id)            => api.patch(`/shops/${id}/toggle`);
export const restartBot = (id)            => api.post(`/shops/${id}/restart`);
export const getStats   = ()              => api.get("/stats");
export const getAudit   = (params)        => api.get("/audit", { params });
export const getBotStatus = ()            => api.get("/bots/status");

export default api;
