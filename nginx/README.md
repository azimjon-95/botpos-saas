# BOT·POS — Lokal NGINX sozlamasi

## Tezkor boshlash

### 1. Talab: NGINX o'rnatish
nginx.org → nginx/Windows → ZIP yuklab `C:\nginx\` ga ochish

### 2. Ishga tushirish tartibi

**Terminal 1 — Backend (port 6060):**
```bash
cd E:\botPos\botpos-saas
copy .env.local .env   # birinchi marta
npm run dev
```

**Terminal 2 — Admin panel (port 3000):**
```bash
cd E:\botPos\botpos-admin
copy .env.local .env   # birinchi marta
npm start
```

**Terminal 3 — WebApp (port 3001):**
```bash
cd E:\botPos\botpos-webapp
copy .env.local .env   # birinchi marta
npm start
# PORT=3001 .env da yozilgan
```

**Terminal 4 — NGINX:**
```bash
# nginx papkasidagi start.bat ni ishga tushiring
# Yoki qo'lda:
cd C:\nginx
nginx.exe
```

### 3. Ochish
| Sahifa | URL |
|---|---|
| Admin panel | http://localhost:8080 |
| WebApp (mijoz) | http://localhost:8081 |
| Backend API | http://localhost:6060 |

## Muammolar

### 80/8080 port band
```bash
netstat -ano | findstr :8080
# PID topib Task Manager da o'chiring
```

### NGINX ishlamaydi
```bash
cd C:\nginx
nginx.exe -t          # config xatosi bormi?
type logs\error.log   # log ko'rish
```

### React port o'zgartirish
`.env` da `PORT=3001` yozilgan bo'lsa WebApp 3001 da ishlaydi.
Agar ishlamasa: `set PORT=3001 && npm start`

## Arxitektura
```
http://localhost:8080  →  NGINX
                              ├── /api/*       → Node.js :6060
                              ├── /socket.io/* → Node.js :6060
                              └── /*           → React Admin :3000

http://localhost:8081  →  NGINX
                              ├── /api/*       → Node.js :6060
                              └── /*           → React WebApp :3001
```
