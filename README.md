# BOT·POS SaaS — Ko'p Do'konli Platforma

> TZ (Texnik Talab) asosida qurilgan — **Bir platformadan cheksiz do'kon, har biri alohida izolyatsiyada**

---

## Tezkor Boshlash

### 1. O'rnatish

```bash
git clone https://github.com/YOUR_USERNAME/botpos-saas.git
cd botpos-saas
npm install
cp .env.example .env
```

### 2. .env to'ldirish

```env
MONGO_URI=mongodb://localhost:27017/botpos_saas
REDIS_URL=redis://localhost:6379
MASTER_ENCRYPTION_KEY=<openssl rand -hex 32 chiqishini yozing>
ADMIN_JWT_SECRET=<uzun tasodifiy satr>
ADMIN_EMAIL=admin@botpos.uz
PORT=6060
WEBAPP_BASE_URL=https://botpos.uz
```

> `MASTER_ENCRYPTION_KEY` olish: `openssl rand -hex 32`

### 3. Super Admin yaratish

```bash
node src/seed/createAdmin.js "YourStrongPass123"
```

### 4. Ishga tushirish

```bash
npm run dev        # Ishlab chiqish
npm start          # Production
pm2 start src/index.js --name botpos-saas  # PM2 bilan
```

---

## Arxitektura (TZ bo'yicha)

```
botpos-saas/
├── src/
│   ├── index.js                    # Asosiy kirish nuqtasi
│   ├── config.js                   # .env o'zgaruvchilari
│   ├── db.js                       # MongoDB ulanish
│   │
│   ├── models/
│   │   ├── Shop.js                 # ⭐ Asosiy — do'konlar jadvali (TZ 2.2)
│   │   ├── Sale.js                 # + shopId
│   │   ├── Expense.js              # + shopId
│   │   ├── Debt.js                 # + shopId
│   │   ├── Worker.js               # + shopId
│   │   ├── Customer.js             # + shopId
│   │   ├── Counter.js              # + shopId (balans, orderNo)
│   │   ├── Supplier.js             # + shopId
│   │   ├── SuperAdmin.js           # Platforma admini
│   │   └── AuditLog.js             # Audit trail
│   │
│   ├── saas/
│   │   ├── botManager.js           # ⭐ TZ 3.3 — dinamik bot boshqaruvi
│   │   ├── shopHandlers.js         # Har do'kon boti uchun handler'lar
│   │   └── customerHandlers.js     # Cashback bot handler'lari
│   │
│   ├── middlewares/
│   │   ├── shopGuard.js            # shopId tekshirish (TZ 4.1)
│   │   ├── verifyTgWebApp.js       # Telegram initData tekshirish
│   │   └── adminAuth.js            # JWT admin auth
│   │
│   ├── routes/
│   │   ├── webapp.js               # /api/webapp/* — WebApp API
│   │   └── admin.js                # /api/admin/* — Admin Panel API
│   │
│   ├── services/
│   │   ├── dashboard.js            # Dashboard agregatsiyalar (shopId bilan)
│   │   ├── saleService.js          # Sotuv saqlash (transaction)
│   │   ├── saleParser.js           # Matn → sotuv items
│   │   └── closeCash.js            # Kassa yopish
│   │
│   ├── utils/
│   │   ├── encrypt.js              # AES-256-GCM (TZ 7 xavfsizlik)
│   │   ├── money.js                # Pul formatlash
│   │   └── time.js                 # Vaqt yordamchilari
│   │
│   └── seed/
│       ├── createAdmin.js          # Birinchi super admin
│       └── migrate.js              # Eski ma'lumotlarni shopId bilan yangilash
│
└── admin-panel/                    # React Admin Panel (TZ 5)
    └── src/
        ├── App.js                  # Routing
        ├── api.js                  # Axios client (JWT bilan)
        ├── components/
        │   └── Layout.js           # Sidebar + asosiy layout
        └── pages/
            ├── LoginPage.js        # JWT login
            ├── Dashboard.js        # Statistika + bot holatlari
            ├── ShopList.js         # Do'konlar ro'yxati + filter + amallar
            ├── ShopCreate.js       # Yangi do'kon forma (TZ 5.1)
            ├── ShopDetail.js       # Do'kon tahrirlash + token yangilash
            └── AuditPage.js        # Audit log (TZ 5)
```

---

## API Endpointlar

### WebApp API (`/api/webapp/*`)

Barcha so'rovlarda `x-shop-id` header + Telegram initData talab qilinadi.

| Method | Endpoint | Tavsif |
|--------|----------|--------|
| GET | `/api/webapp/dashboard/summary` | Karta ko'rsatkichlari |
| GET | `/api/webapp/dashboard/activity` | Sotuvlar va chiqimlar |
| GET | `/api/webapp/dashboard/chart` | Soatlik grafik |

### Admin API (`/api/admin/*`)

| Method | Endpoint | Tavsif |
|--------|----------|--------|
| POST | `/api/admin/login` | JWT token olish |
| POST | `/api/admin/refresh` | Token yangilash |
| GET | `/api/admin/shops` | Do'konlar ro'yxati |
| POST | `/api/admin/shops` | Yangi do'kon + bot start |
| PUT | `/api/admin/shops/:id` | Do'kon tahrirlash + bot restart |
| PATCH | `/api/admin/shops/:id/toggle` | Faollashtirish/to'xtatish |
| POST | `/api/admin/shops/:id/restart` | Bot restart |
| GET | `/api/admin/stats` | Umumiy statistika |
| GET | `/api/admin/audit` | Audit log |
| GET | `/api/admin/bots/status` | Barcha bot holatlari |

---

## TZ bo'yicha Xavfsizlik (7-bo'lim)

| Talab | Amalga oshirilish |
|-------|-------------------|
| Bot tokenlar shifrlangan | ✅ AES-256-GCM (`utils/encrypt.js`) |
| shopId izolyatsiya | ✅ Har query da `shopId` filter (`shopGuard.js`) |
| Admin panel JWT | ✅ 1 soatlik token + 7 kunlik refresh |
| Audit log | ✅ Barcha admin amallari logga yoziladi |
| Cross-shop so'rov | ✅ Middleware da 403 qaytariladi |

---

## Mavjud Do'konni Ko'chirish (Migratsiya)

Eski `cake-shop-telegram-bot` dan ma'lumotlarni ko'chirish:

```bash
# 1. Admin paneldan yangi do'kon yarating — shopId oling
# 2. Migratsiya skriptini ishlatng:
node src/seed/migrate.js shopId=<yangi_dokon_id>
```

---

## Admin Panel ishga tushirish

```bash
cd admin-panel
npm install
npm start      # localhost:3000 da ochiladi
```

Production uchun:
```bash
npm run build  # build/ papkasiga
# Nginx bilan serve qiling, /api/* → localhost:6060 proxy
```

---

## Keyingi bosqichlar (TZ rejasi)

- [ ] **Bosqich 5 — Xavfsizlik**: Rate limiting, 2FA (TOTP), kalit almashtirish
- [ ] **Bosqich 6 — Test**: 2-3 test do'kon, izolyatsiya tekshiruvi, PM2 cluster
- [ ] WebApp da `?shop=ID` dan shopId olish va barcha API'ga uzatish
- [ ] Subdomain qo'llab-quvvatlash (`totli.botpos.uz`)
- [ ] Do'kon uchun alohida backup scheduler

---

## Muhim Eslatma

> **Mavjud loyihalar (`cake-shop-telegram-bot`, `totli_webapp`) o'ZGARTIRILMAGAN.**
> Bu butunlay yangi, alohida repo — SaaS arxitekturasi ularning ustiga qurilgan.
