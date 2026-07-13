# AI4Home — Warranty Care Portal

A multi-tenant SaaS portal for home-builder / warranty companies. It hosts **two
workspaces** behind one login, each independently entitled per tenant:

- **Warranty workspace** — homeowner warranty support. The conversational AI
  (intake, diagnosis, escalation) lives in **Botpress**; the portal owns the
  ticket dashboard, ERP/CRM sync, knowledge-base management, company/widget
  branding, and KPI reporting.
- **Sales workspace** — AI-assisted outbound sales. Runs on a **native
  Claude + Inngest** runtime: lead management, nurture campaigns, Salesforce
  sync, announcements, appointment scheduling, a blog-drafting agent, and a
  semantic knowledge base.

Feature-level status is tracked in detail in
[`warranty-workspace.md`](./warranty-workspace.md) and
[`sales-workspace.md`](./sales-workspace.md). A technical-audit log lives in
[`AUDIT.md`](./AUDIT.md).

---

## Architecture

```
┌─────────────────────────┐        /api/* (proxied in dev,           ┌──────────────────────────┐
│  Next.js 16 frontend     │  ───▶  api/index.js on Vercel)   ───▶    │  Express 5 backend        │
│  (src/) — React 19       │                                          │  (server/src/)            │
│  App Router, Tailwind 4   │  ◀──   JSON                              │  controllers/routes/      │
└─────────────────────────┘                                          │  services + Inngest jobs   │
        │                                                             └──────────────────────────┘
        │ Supabase Auth (SSR cookies)                                          │
        ▼                                                                      ▼
   Supabase (auth)                                              Prisma 7 ──▶ PostgreSQL (Supabase)
                                                                Inngest ──▶ background functions
                                                                Botpress (warranty bot, embedded widget)
```

- **Frontend** (`src/`): Next.js App Router. Talks to the backend exclusively
  over `/api/*`. In development, `next.config.ts` rewrites `/api/*` to
  `http://localhost:5000`. The frontend does **not** access the database
  directly — all data access goes through the Express API.
- **Backend** (`server/`): a standalone Express app (`server/src/index.js`).
  Route groups are guarded by `requireAuth` + `requireWorkspace("sales"|"warranty")`.
  Background/async work (campaign sends, CSV import, scheduling, news scraping,
  Salesforce cron, KB ingest) runs as **Inngest** functions.
- **Serverless entry** (`api/index.js`): re-exports the Express app so Vercel
  serves the whole backend as one function (`vercel.json` rewrites `/api/(.*)`).
- **Auth**: Supabase email/password for normal users; a separate env-only
  **Super Admin** session (server-side cookie) for the platform admin.
- **Database**: single Postgres (Supabase), accessed via Prisma 7 with the
  `@prisma/adapter-pg` driver adapter over a `pg` pool. Schema:
  `prisma/schema.prisma`.

### Tech stack
Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS 4 · Radix UI / shadcn ·
Express 5 · Prisma 7 · PostgreSQL (Supabase) · Supabase Auth · Inngest ·
Botpress (warranty bot) · Salesforce & Google Calendar integrations ·
Twilio (SMS) · Brevo/SMTP (email) · local `@xenova/transformers` embeddings +
pgvector (Sales KB).

---

## Project structure

```
src/                      Next.js frontend
  app/                    App Router pages (admin, warranty/*, sales/*, blog, widget, ...)
  components/             UI + layout + auth components (ui/ = shadcn primitives)
  contexts/AuthContext    Client auth state, session-expiry interceptor
  lib/                    Frontend helpers (utils, supabase client)
  middleware.ts           Route protection (Supabase SSR)
server/                   Express backend
  src/routes/             Route definitions (mounted in src/index.js)
  src/controllers/        Request handlers
  src/services/           Integrations (Salesforce, ERP, mail, SMS, calendar, vector store)
  src/inngest/functions/  Background jobs
  src/middlewares/        auth, webhook-auth, twilio-auth
  src/lib/                Shared server utils (prisma, crypto, llm, timezone, ...)
api/index.js              Vercel serverless wrapper around the Express app
prisma/
  schema.prisma           Data model (~35 models/enums)
  pgvector-setup.sql      One-time pgvector DDL for Sales KB semantic search
```

---

## Prerequisites

- Node.js 20+
- A PostgreSQL database (Supabase recommended)
- A Supabase project (for auth)
- Optional per-feature: Botpress bot, Anthropic or Groq API key, Salesforce
  connected app, Google OAuth app, Twilio, Brevo/SMTP, Inngest account.

---

## Setup

```bash
# 1. Install frontend deps (repo root)
npm install

# 2. Install backend deps
cd server && npm install && cd ..

# 3. Configure environment
cp .env.example .env               # frontend / build vars
cp server/.env.example server/.env # backend vars (fill in real values)

# 4. Generate the Prisma client and push the schema
npx prisma generate
npx prisma db push                 # creates/updates tables (additive)

# 5. (Sales KB only) enable pgvector semantic search — one time per DB
#    Run prisma/pgvector-setup.sql via the Supabase SQL editor or psql,
#    then POST /api/sales/kb/reindex until remaining=0.
```

### Running locally (two processes)

```bash
# Terminal 1 — backend on :5000
cd server && npm run dev

# Terminal 2 — frontend on :3000 (proxies /api → :5000)
npm run dev
```

Open http://localhost:3000.

---

## Environment variables

There are **two** env files. Locally the frontend reads root `.env` and the
backend reads `server/.env`. On Vercel everything runs from one deployment, so
the **root environment must contain the backend variables too** — use
`server/.env.example` as the authoritative list of backend keys.

**Frontend (`.env` — see `.env.example`)**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_URL` | Public portal URL (CORS + redirect base) |
| `DATABASE_URL` | Postgres URL (used by `prisma generate`/`db push`) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase auth (client) |
| `NEXT_PUBLIC_BOTPRESS_BOT_ID` / `_INJECT_URL` / `_CONFIG_URL` | Warranty chat widget |

**Backend (`server/.env` — see `server/.env.example`)** — highlights:

| Variable | Purpose |
|---|---|
| `PORT` | Backend port (default 5000) |
| `DATABASE_URL` | Postgres connection |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase auth verification |
| `SESSION_SECRET` | Super Admin session signing |
| `APP_ENCRYPTION_KEY` | **AES-256-GCM key for integration secrets at rest** (fallback: `SALESFORCE_ENCRYPTION_KEY`). Must be a strong 32-char value in production — a startup warning fires if left at the default. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Primary LLM (Sales). Falls back to Groq if not a real `sk-ant-` key. |
| `GROQ_API_KEY` / `GROQ_MODEL` | Groq LLM fallback (`OPENAI_API_KEY` holding a `gsk_` key is also accepted for back-compat; it is **not** used for embeddings) |
| `SMTP_*` / `SENDER_EMAIL` | Transactional + campaign email (Brevo) |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Google Calendar / Meet |
| `INBOUND_WEBHOOK_SECRET` | Shared secret for Brevo/Twilio inbound webhooks |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` / `INNGEST_DEV` | Inngest background jobs |
| `COMPLAINT_RATE_*`, `COMPLIANCE_ALERT_EMAIL` | Messaging compliance thresholds |

> Secrets live only in `.env` files, which are git-ignored. Never commit real
> credentials; only `.env.example` files are tracked.

---

## Commands

**Root (frontend):**

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server (:3000) |
| `npm run build` | `prisma generate` + production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check (currently clean) |

**Backend (`server/`):**

| Command | Description |
|---|---|
| `npm run dev` | Nodemon + Inngest dev mode |
| `npm run start` | Start the Express server |

**Database:** `npx prisma generate`, `npx prisma db push`, `npx prisma studio`.

---

## Deployment (Vercel)

- `api/index.js` exposes the Express app; `vercel.json` routes `/api/(.*)` to it.
- The root `package.json` must declare every backend runtime dependency (the
  server folder is not separately installed on Vercel).
- Set all backend env vars in the Vercel project environment.
- `@xenova/transformers` is included in the root deps so the Sales KB embedding
  model loads on Vercel. Semantic search still requires the one-time
  `prisma/pgvector-setup.sql`; without it the code degrades gracefully to
  full-text search. See [Known limitations](#known-limitations).

---
