# AI4Home — Warranty Care Portal

## Overview

A multi-tenant SaaS portal for home-builder / warranty companies. It hosts **two workspaces** behind one login, each independently entitled per tenant:

- **Warranty workspace** — homeowner warranty support. The conversational AI (intake, diagnosis, escalation) lives in **Botpress**; the portal owns the ticket dashboard, ERP/CRM sync, knowledge-base management, company/widget branding, and KPI reporting.
- **Sales workspace** — AI-assisted outbound sales. Runs on a **native Claude + Inngest** runtime: lead management, nurture campaigns, Salesforce sync, announcements, appointment scheduling, a blog-drafting agent, and a semantic knowledge base.

---

## Architecture

```text
┌─────────────────────────┐        /api/* (proxied in dev,           ┌──────────────────────────┐
│  Next.js 16 frontend    │  ───▶  api/index.js on Vercel)   ───▶    │  Express 5 backend       │
│  (src/) — React 19      │                                          │  (server/src/)           │
│  App Router, Tailwind 4 │  ◀──   JSON                              │  controllers/routes/     │
└─────────────────────────┘                                          │  services + Inngest jobs │
        │                                                             └──────────────────────────┘
        │ Supabase Auth (SSR cookies)                                          │
        ▼                                                                      ▼
   Supabase (auth)                                              Prisma 7 ──▶ PostgreSQL (Supabase)
                                                                Inngest ──▶ background functions
                                                                Botpress (warranty bot, embedded widget)
```

- **Frontend** (`src/`): Next.js App Router. Talks to the backend exclusively over `/api/*`. In development, `next.config.ts` rewrites `/api/*` to the `BACKEND_URL` configured in `.env`. The frontend does **not** access the database directly — all data access goes through the Express API.
- **Backend** (`server/`): a standalone Express app (`server/src/index.js`). Route groups are guarded by `requireAuth` + `requireWorkspace("sales"|"warranty")`. Background/async work (campaign sends, CSV import, scheduling, news scraping, Salesforce cron, KB ingest) runs as **Inngest** functions.
- **Serverless entry** (`api/index.js`): re-exports the Express app so Vercel serves the whole backend as one function (`vercel.json` rewrites `/api/(.*)`).
- **Auth**: Supabase email/password for normal users; a separate env-only **Super Admin** session (server-side cookie) for the platform admin.
- **Database**: single Postgres (Supabase), accessed via Prisma 7 with the `@prisma/adapter-pg` driver adapter over a `pg` pool. Schema: `prisma/schema.prisma`.

---

## Tech Stack

Next.js 16 · React 19 · TypeScript 5 · Tailwind CSS 4 · Radix UI / shadcn · Express 5 · Prisma 7 · PostgreSQL (Supabase) · Supabase Auth · Inngest · Botpress (warranty bot) · Salesforce & Google Calendar integrations · Twilio (SMS) · Brevo/SMTP (email) · local `@xenova/transformers` embeddings + pgvector (Sales KB).

---

## Project Structure

```text
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

## Setup

**Prerequisites:** Node.js 20+, PostgreSQL database (Supabase recommended), Supabase Auth project. Optional integrations: Botpress, Anthropic API key, Salesforce app, Google OAuth, Twilio, Brevo, Inngest.

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

---

## Running

The system requires both the Next.js frontend and Express backend running concurrently in development.

```bash
# Terminal 1 — backend on :5000
cd server && npm run dev

# Terminal 2 — frontend on :3000 (proxies /api → :5000)
npm run dev
```

Open the URL `http://localhost:3000` to view the portal.

---

## Env's

The following represents the complete list of environment variables used across the frontend and backend codebase. Locally, the frontend reads from root `.env` and the backend from `server/.env`. On deployment platforms like Vercel, all variables must be configured in a single environment.

| Variable | Scope | Description |
|---|---|---|
| `NEXT_PUBLIC_URL` | Frontend & Backend | Public portal URL used for CORS, redirects, and link generation |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend & Backend | Supabase instance URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend & Backend | Public anonymous access key |
| `NEXT_PUBLIC_BOTPRESS_INJECT_URL` | Frontend | For homeowner support bot |
| `NEXT_PUBLIC_BOTPRESS_CONFIG_URL` | Frontend | For homeowner support bot |
| `PORT` | Backend | Express server port (5000) |
| `NODE_ENV` | Backend | Environment mode (`development` / `production`) |
| `VERCEL` | Backend | Detects serverless deployment |
| `AWS_LAMBDA_FUNCTION_NAME` | Backend | Detects AWS serverless deployment |
| `DATABASE_URL` | Backend | Postgres connection string for Prisma |
| `APP_ENCRYPTION_KEY` | Backend | AES-256-GCM key for encrypting integration secrets at rest |
| `SESSION_SECRET` | Backend | Signs Super Admin session cookies |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Secure key for admin-level database bypass |
| `INNGEST_EVENT_KEY` | Backend | Key for publishing events to Inngest |
| `INNGEST_SIGNING_KEY` | Backend | Validates webhook requests from Inngest |
| `INNGEST_DEV` | Backend | Local dev mode toggle (`1`) |

| `SENDER_EMAIL` | Backend | Transactional emails sender address |
| `SMTP_HOST` | Backend | Transactional emails SMTP host |
| `SMTP_PORT` | Backend | Transactional emails SMTP port |
| `SMTP_USER` | Backend | Transactional emails SMTP user |
| `SMTP_PASS` | Backend | Transactional emails SMTP password |
| `TWILIO_ACCOUNT_SID` | Backend | Inbound SMS fallback / sending |
| `TWILIO_AUTH_TOKEN` | Backend | Inbound SMS fallback / sending |
| `TWILIO_FROM_NUMBER` | Backend | Inbound SMS fallback / sending |
| `ANTHROPIC_API_KEY` | Backend | Platform-wide primary LLM (Claude) |
| `GOOGLE_CLIENT_ID` | Backend | Google Cloud OAuth for Calendar/Meet |
| `GOOGLE_CLIENT_SECRET` | Backend | Google Cloud OAuth for Calendar/Meet |
| `GOOGLE_REDIRECT_URI` | Backend | Google Cloud OAuth for Calendar/Meet |
| `SUPERADMIN_EMAIL` | Backend | Default super admin login email |
| `SUPERADMIN_PASSWORD` | Backend | Default super admin login password |
| `ADMIN_NOTIFY_EMAIL` | Backend | Target email for new tenant registration alerts |
| `ADMIN_NOTIFY_PHONE` | Backend | Target phone for new tenant registration alerts |

---

## Commands

**Root (frontend):**

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server (:3000) |
| `npm run build` | `prisma generate` + production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check |

**Backend (`server/`):**

| Command | Description |
|---|---|
| `npm run dev` | Nodemon + Inngest dev mode |
| `npm run start` | Start the Express server |

**Database:** 
`npx prisma generate` (Creates client), `npx prisma db push` (Pushes schema), `npx prisma studio` (UI for viewing DB).

---

## Deployment

- `api/index.js` exposes the Express app; `vercel.json` routes `/api/(.*)` to it.
- The root `package.json` must declare every backend runtime dependency (the server folder is not separately installed on Vercel).
- Set all backend env vars in the deployment environment.
- `@xenova/transformers` is included in the root deps so the Sales KB embedding model loads in production. Semantic search still requires the one-time `prisma/pgvector-setup.sql`; without it the code degrades gracefully to full-text search.

---

## Summary

The AI4Home platform encapsulates conversational AI for both Warranty and Sales, operating within a modern Next.js/Express monolith backed by Supabase and Inngest. It provides builders with deep integrations into Salesforce and Botpress, allowing them to manage homeowners efficiently through automated AI pipelines.
