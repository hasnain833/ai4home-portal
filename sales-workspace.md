# Sales Workspace — Task Board

Tracks the **open** work for the Sales Workspace against the **Ai.Lumen Sales
Workspace SRS v1.1** (`sales-workspace-srs.pdf`). For the code-level technical
audit see [`AUDIT.md`](./AUDIT.md); for the warranty side see
[`warranty-workspace.md`](./warranty-workspace.md). Shipped items are in
[Recently completed](#-recently-completed) at the bottom.

_Last updated: 2026-07-16._

> **Runtime note** — Per SRS §11.4, the Sales AI features run on the native
> **Claude + Inngest** runtime. Botpress is the Warranty-workspace bot engine
> only.

### Legend

- `- [ ]` open task · `- [x]` done.
- 🔴 **Open** (not started) · 🟡 **Partial** (core works, gaps remain) · ⚙️ **Operational** (code done, one-time env/DB step pending) · ✅ **Done**.

---

## 🔄 CRM Sync Agent — `SW-CRM`

- [ ] 🔴 **`SW-CRM-007` (extend) — Persistent-failure alerting.** Repeated sync /
  write-back failures are only written to `SyncLog`. Surface them to admins —
  e.g. an email digest reusing the existing complaint-rate alert mailer
  (`ComplianceService.sendComplaintRateAlert`), since the shared notification
  center was dropped from scope.

---

## 📚 Sales KB & Brand Voice — `SW-KB` / `SW-AGT`

- [ ] 🟡 **`SW-AGT-001` — Agent runtime abstraction.** Retrieval is a clean,
  reusable service (`vector-store.service.js`). Remaining work is only wiring new
  AI consumers to it as they're built.
- [ ] 🔴 **`SW-KB-007` — Config safety.** Prompt-affecting config (brand profile,
  agent toggles) is **not versioned with rollback**, and there is **no
  preview/sandbox mode** to test AI behaviour before it affects live sends.

---

## 📊 Workspace Dashboard & Reporting — `SW-DSH`

- [ ] 🟡 **`SW-DSH-001` — Dashboard completeness.**
  - [ ] Show **active sequences/campaigns with key metrics** (only a raw count is
    shown today).
  - [ ] Surface **upcoming calendar items**.
- [ ] 🟡 **`SW-DSH-002` — Report CSV export.** `exportDashboardCsv` exports
  **leads only**. The SRS wants every reporting view exportable — add CSV export
  for campaign, announcement, and automation analytics.

---

## 🧩 Cross-cutting SRS Coverage

- [ ] 🟡 **§4.12 — Role-to-Feature Matrix.** RBAC exists (ADMIN / STAFF /
  HOMEOWNER). Audit each Sales route against the SRS matrix; not yet mapped:
  - [ ] Builder-Member "per-permission" granularity.
  - [ ] Homeowner "own leads / limited templates" scoping.
  - [ ] Platform-Admin views.

---

## 🏗️ Infrastructure & Security

- [ ] 🟡 **DB connection resilience.** The `pg` pool is hardened (keep-alive,
  longer connect timeout, dead-client eviction). Still worth doing:
  - [ ] A short retry-on-transient-error wrapper around auth's DB lookup.
  - [ ] Evaluate the transaction pooler (`:6543`) vs. the session pooler for this
    long-running server.
- [ ] 🔴 **`NFR-SC-002` — Tenant-scoped Inngest context.** Plus a dead-letter path
  for failed background jobs.
- [ ] 🟡 **`NFR-S-003` — Secrets / encryption at rest.**
  - [x] Salesforce **and** Google Calendar OAuth tokens are AES-256-GCM encrypted
    at rest; app fails closed in production if the default key is used (see
    [`AUDIT.md`](./AUDIT.md)).
  - [ ] Set a strong `APP_ENCRYPTION_KEY` in production and re-encrypt any secrets
    written under the old default key (operational — see below).
  - [ ] Optional: move all provider secrets to a real secrets vault.
- [ ] 🔴 **Compliance & privacy.**
  - [ ] `NFR-S-008` — merge-field injection-safe rendering.
  - [ ] `NFR-S-007` — AI PII minimization.
  - [ ] `NFR-S-005` — GDPR / CCPA data export & delete.
  - [ ] `NFR-S-004` — Audit log (the `AuditLog` model + helper exist; confirm it's
    wired across the Sales mutations).

---

## 🏢 Additional Client Requests (beyond the SRS)

- [ ] 🔴 **Literal payment / invoice gating.** Upload invoice, "clear invoices to
  proceed", auto-share invoice, welcome email after first invoice paid. The
  document-verification gate shipped instead (env-only super-admin login,
  `/admin` UI, welcome email on approval, gated by `Company.verificationStatus` —
  no Invoice/Payment model) — decide with the client whether real invoicing is
  still required.

---

## 📰 News & Blog distribution

- [x] ✅ **`SW-NEWS-001` — Per-tenant news sources** ⚙️ *(code done 2026-07-16;
  needs `prisma db push` — see Operational steps).* The old scraper fetched **one
  hard-coded Google News RSS feed** and cloned identical articles to every
  sales-enabled company. Now tenant-configurable:
  - [x] `Company.newsSources` field + validation/normalization
    (`server/src/lib/news-sources.js`).
  - [x] Scraper iterates each tenant's sources with per-source failure isolation
    (`SW-NEWS-006`) and a platform-default fallback
    (`server/src/services/news-service.js`, `news-scraper.js`).
  - [x] Settings UI to manage feeds (`NewsSourcesTab` in `/sales/settings`).
  - [x] On-demand "fetch latest" refresh (`POST /api/sales/news/refresh`) on the
    settings tab and the News page.
- [x] ✅ **`SW-BLOG-005` — Blog output targets** *(verified 2026-07-16).*
  Everything the SRS literally requires is done: publish to the workspace-hosted
  per-tenant blog page (`/blog/[companyId]`, reads via `/api/public/blog/...`;
  `/blog` is now on the middleware public-route allowlist so anonymous readers
  can reach it) and export as **HTML/Markdown**. Sample data seeder:
  `server/scripts/seed-blog.mjs`.
  - De-scoped per client (2026-07-16): Strapi-style embeddable widget /
    CORS-enabled headless content API, and the SRS "should-have" **direct
    WordPress integration** — not building these.

---

## ⚙️ Operational steps (code done — run once per environment)

Not coding tasks; these activate finished features on a live database /
environment.

- [ ] **`prisma db push`** — applies pending additive schema changes: new
  `Company` columns for tenant-configurable lead statuses + SMS quiet hours +
  **per-tenant `newsSources` (`SW-NEWS-001`)**; the `BlogPost` table; drops the
  removed `ScrapedNews.wasBroadcasted` column; the `AuditLog` table.
- [ ] **`prisma/pgvector-setup.sql`** then **`POST /api/sales/kb/reindex`** —
  enables pgvector semantic KB search. Until then, retrieval falls back to
  full-text search.
- [ ] **Set a strong `APP_ENCRYPTION_KEY`** in production. Fail-closed is now
  active, so production refuses to store integration secrets under the default
  key.

---

## 🗒️ De-scoped (per client, not building)

- [x] **News / Nurture auto-share** — no auto-campaign; the manual flow (create a
  campaign, then launch it) is built and is the intended process.
- [x] **Shared notification center** (`HUB-007`) — not required.
- [x] **Announcement image editor & radius/geo targeting** — not required.
- [x] **Per-timezone quiet-hours auto-requeue** — replaced by tenant-configurable
  quiet hours + admin-set send time.

---

## ❓ Needs a client decision (outside current SRS)

- [ ] 🔴 **Per-company AI/LLM API key from the frontend** *(contradicts SRS).* A
  note asked to *"send the Claude/other API key in the env to the frontend so
  every company puts their own."* The SRS specifies the **opposite**: `SW-AGT-002`
  wants a **shared platform** LLM service (`Claude, configurable` = platform swaps
  providers, not per-tenant BYO key), and `NFR-S-003` requires provider keys to
  live in a secrets manager, **never exposed** — shipping a key to the browser
  would violate it. If per-tenant AI billing/keys are genuinely wanted, it must be
  stored and used **server-side only**, and needs explicit client sign-off first.

---


