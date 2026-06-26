# BOT·POS SaaS — Backend

Ko'p do'konli Telegram bot platformasi. Node.js + MongoDB + Redis.

## Repolar

| Repo | Maqsad |
|---|---|
| **botpos-saas** (shu repo) | Backend server |
| **botpos-admin** | Admin panel (React) — alohida repo |
| **botpos-webapp** | Do'kon sayt (React) — alohida repo |

## Deploy (Render)

1. `MONGO_URI`, `MASTER_ENCRYPTION_KEY`, `ADMIN_JWT_SECRET` — `.env` ga
2. `node src/seed/createAdmin.js "Parol"` — admin yaratish
3. `BACKUP_CHAT_ID` — kunlik backup uchun

## .env.example faylga qarang
