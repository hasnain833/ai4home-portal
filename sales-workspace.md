# Sales Workspace — Remaining Work

Tracks the **open** work for the Sales Workspace against the **Ai.Lumen Sales
Workspace SRS v1.1** (`sales-workspace-srs.pdf`).

Only remaining tasks are listed here. For completed features see the
[Recently completed](#-recently-completed) summary at the bottom; for the
code-level technical audit see [`AUDIT.md`](./AUDIT.md); for the warranty side
see [`warranty-workspace.md`](./warranty-workspace.md).

_Last updated: 2026-07-13._

> **Runtime note** — Per SRS §11.4, the Sales AI features run on the native
> **Claude + Inngest** runtime. Botpress is the Warranty-workspace bot engine
> only.

### Legend

- 🔴 **Open** — not started.
- 🟡 **Partial** — core works; specific gaps remain.
- ⚙️ **Operational** — code is done; a one-time environment/DB step is pending.

---

## 🧱 Foundation — Hub & Lead Model

**Lead deduplication** — `SW-LEAD-003` · ✅ Completed 2026-07-13

Cross-source linking implemented: a Salesforce record matching an existing
CSV/manual lead now links to it (Salesforce becomes system-of-record) instead of
creating a duplicate, and CSV/manual imports no longer overwrite Salesforce-owned
fields — they only fill the gaps. Verified with unit tests.

**Lead lifecycle statuses** — `SW-LEAD-006` · 🟡 Partial

The status set works, but it's hardcoded — not yet tenant-configurable.

**Notification routing** — `HUB-007` · 🔴 Open

No shared, workspace-tagged notification center with deep links. Several other
items below depend on this.

---

## 🔔 Announcements Agent — `SW-ANN`

🔴 Open · deferred to v2:

- Rich-text / image editor for announcement content.
- Radius (geo) targeting.
- Dead-letter queue surfaced in the UI.
- Per-timezone SMS quiet-hours deferral — SMS blocked by quiet hours are
  currently **skipped**, not requeued for later.

---

## 🔄 CRM Sync Agent — `SW-CRM`

**Write-back coverage** — `SW-CRM-008` (extend) · ✅ Completed 2026-07-13

- ✅ Appointment-booked (status → "Appointment Set") now writes back from both
  booking paths; unsubscribe now writes the consent/opt-out back to Salesforce.
- ✅ Settings UI toggle for `writeBackEnabled` added (Salesforce card).

**Persistent-failure alerting** — `SW-CRM-007` (extend) · 🔴 Open

Repeated sync / write-back failures are only written to `SyncLog`. Surface them
as an admin notification. _Depends on the notification center (`HUB-007`)._

---

## 📰 News Scraping Agent — `SW-NEWS`

**News auto-share pipeline** — 🟡 Partial

News already feeds the Market News feed and calendar suggestions. The blog
drafter backend it was waiting on is now built (see
[Recently completed](#-recently-completed)), so the remaining work is to wire
the **Nurture Agent auto-share** of news / mortgage-rate / home-pricing updates
(also listed under [Client requests](#-additional-client-requests)).

---

## 🤝 Automated Marketing Rules Agent — `SW-AMK` · ✅ Completed 2026-07-13

- ✅ New actions wired: `SEND_EMAIL`, `SEND_SMS` (compliance-gated), `CREATE_TASK`
  (lead-timeline task), `DRAFT_ANNOUNCEMENT`. Merge fields are injection-safe.
- ✅ `APPOINTMENT_BOOKED` fires from both booking paths; `DATE_BASED` triggers run
  via a daily cron with new `OLDER_THAN_DAYS` / `NEWER_THAN_DAYS` operators.
- ✅ Daily send cap enforced — a shared budget skips further sends once
  `automationDailyCap` is reached.
- ✅ Analytics UI panel surfaced on the automations page.
- ✅ Verified with unit tests (conditions, merge-fields, cap accounting).

---

## 📚 Sales KB & Brand Voice — `SW-KB` / `SW-AGT`

**Agent runtime abstraction** — `SW-AGT-001` · 🟡 Partial

Retrieval is a clean, reusable service (`vector-store.service.js`). Remaining
work is only wiring new AI consumers to it as they're built.

**Config safety** — `SW-KB-007` · 🔴 Open

Prompt-affecting config (brand profile, agent toggles) is **not versioned with
rollback**, and there is **no preview/sandbox mode** to test AI behaviour before
it affects live sends.

---

## 📊 Workspace Dashboard & Reporting — `SW-DSH`

**Dashboard completeness** — `SW-DSH-001` · 🟡 Partial

- Show **active sequences/campaigns with key metrics** (only a raw count is
  shown today).
- Surface **upcoming calendar items**.

**Report CSV export** — `SW-DSH-002` · 🟡 Partial

`exportDashboardCsv` exports **leads only**. The SRS wants every reporting view
exportable — add CSV export for campaign, announcement, and automation
analytics.

---

## 🧩 Cross-cutting SRS Coverage

**Role-to-Feature Matrix** — §4.12 · 🟡 Partial

RBAC exists (ADMIN / STAFF / HOMEOWNER). Not yet mapped:

- Builder-Member "per-permission" granularity.
- Homeowner "own leads / limited templates" scoping.
- Platform-Admin views.

Action: audit each Sales route against the SRS matrix.

---

## 🏗️ Infrastructure & Security

**DB connection resilience** — 🟡 Partial

The `pg` pool is hardened (keep-alive, longer connect timeout, dead-client
eviction). Still worth doing:

- A short retry-on-transient-error wrapper around auth's DB lookup.
- Evaluate the transaction pooler (`:6543`) vs. the session pooler for this
  long-running server.

**Tenant-scoped Inngest context** — `NFR-SC-002` · 🔴 Open

Plus a dead-letter path for failed background jobs.

**Secrets / encryption at rest** — `NFR-S-003` · 🟡 Partial

- ✅ Salesforce tokens **and** Google Calendar OAuth tokens are now AES-256-GCM
  encrypted at rest, and the app fails closed in production if the default key
  is used (see [`AUDIT.md`](./AUDIT.md)).
- Remaining: set a strong `APP_ENCRYPTION_KEY` in production and re-encrypt any
  secrets written under the old default key (operational — see below).
- Optional: move all provider secrets to a real secrets vault.

**Compliance & privacy** — 🔴 Open

- Merge-field injection-safe rendering — `NFR-S-008`.
- AI PII minimization — `NFR-S-007`.
- GDPR / CCPA data export & delete — `NFR-S-005`.
- Audit log — `NFR-S-004` (the `AuditLog` model + helper exist; confirm it's
  wired across the Sales mutations).

---

## 🏢 Additional Client Requests (beyond the SRS)

The Super Admin portal + tenant document-verification gate are **built**
(env-only super-admin login, `/admin` UI, welcome email on approval). Gating is
driven by `Company.verificationStatus` — there is no Invoice/Payment model.
Remaining:

**Literal payment / invoice gating** — 🔴 Open

Upload invoice, "clear invoices to proceed", auto-share invoice, welcome email
after first invoice paid. The document-verification gate shipped instead —
decide with the client whether real invoicing is still required.

**Legal pages** — 🔴 Open

No Terms of Service or Privacy Policy pages exist under `src/app`.

**Nurture Agent auto-share** — 🔴 Open

Auto-share news, mortgage rates, and home-pricing updates using blog-scraper
content. Now unblocked (the SW-BLOG backend is built).

---

## ⚙️ Operational steps (code done — run once per environment)

These aren't coding tasks; they activate finished features on a live database /
environment:

- **`prisma db push`** — applies pending additive schema changes (e.g. the
  `BlogPost` table; drops the removed `ScrapedNews.wasBroadcasted` column; the
  `AuditLog` table).
- **`prisma/pgvector-setup.sql`** then **`POST /api/sales/kb/reindex`** — enables
  pgvector semantic KB search. Until then, retrieval falls back to full-text
  search.
- **Set a strong `APP_ENCRYPTION_KEY`** in production. Fail-closed is now active,
  so production refuses to store integration secrets under the default key.

---

## ✅ Recently completed

For reference — these were delivered and verified, most recent first:

- **Blog Drafting Agent** (`SW-BLOG-001…006`) — full backend (`BlogPost` model,
  14 endpoints) + real UI + public tenant-hosted reader.
- **Sales KB semantic search** (`SW-KB-002`) — pgvector cosine over local
  MiniLM embeddings, with FTS fallback; no paid embedding provider.
- **Nurture Agent polish** (`SW-NUR-002/003/007/008`) — segment enrollment,
  campaign settings UI, live Brevo delivered/opened/clicked, mid-run MIGRATE.
- **CRM Sync Agent** (`SW-CRM-006…009`) — scheduled sync + deletion archive,
  rate-limit/backoff, opt-in write-back, consent-on-import.
- **AI Content Calendar** — month/week/list views, drag-and-drop reschedule,
  announcements + scheduled blog posts as items.
- **Workspace entitlements** (`HUB-003/009`) — server-side `requireWorkspace`
  guard on every private `/api/sales/*` route (403, not just a hidden UI).
- **Unified LLM provider** — all AI features route through `lib/llm.js`
  (Anthropic `claude-sonnet-5`, Groq fallback).
