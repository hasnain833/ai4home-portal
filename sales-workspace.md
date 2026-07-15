# Sales Workspace — Remaining Work

Tracks the **open** work for the Sales Workspace against the **Ai.Lumen Sales
Workspace SRS v1.1** (`sales-workspace-srs.pdf`).

Only remaining tasks are listed here. For completed features see the
[Recently completed](#-recently-completed) summary at the bottom; for the
code-level technical audit see [`AUDIT.md`](./AUDIT.md); for the warranty side
see [`warranty-workspace.md`](./warranty-workspace.md).

_Last updated: 2026-07-14._

> **Runtime note** — Per SRS §11.4, the Sales AI features run on the native
> **Claude + Inngest** runtime. Botpress is the Warranty-workspace bot engine
> only.

### Legend

- 🔴 **Open** — not started.
- 🟡 **Partial** — core works; specific gaps remain.
- ⚙️ **Operational** — code is done; a one-time environment/DB step is pending.

---

## 🔄 CRM Sync Agent — `SW-CRM`

**Persistent-failure alerting** — `SW-CRM-007` (extend) · 🔴 Open

Repeated sync / write-back failures are only written to `SyncLog`. Surface them
to admins — e.g. an email digest reusing the existing complaint-rate alert
mailer (`ComplianceService.sendComplaintRateAlert`), since the shared
notification center was dropped from scope.

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

---

## ⚙️ Operational steps (code done — run once per environment)

These aren't coding tasks; they activate finished features on a live database /
environment:

- **`prisma db push`** — applies pending additive schema changes (the new
  `Company` columns for tenant-configurable lead statuses + SMS quiet hours; the
  `BlogPost` table; drops the removed `ScrapedNews.wasBroadcasted` column; the
  `AuditLog` table).
- **`prisma/pgvector-setup.sql`** then **`POST /api/sales/kb/reindex`** — enables
  pgvector semantic KB search. Until then, retrieval falls back to full-text
  search.
- **Set a strong `APP_ENCRYPTION_KEY`** in production. Fail-closed is now active,
  so production refuses to store integration secrets under the default key.

---



## 🗒️ De-scoped (per client, not building)

- **News / Nurture auto-share** — no auto-campaign. The manual flow (create a
  campaign, then launch it) is already built and is the intended process.
- **Shared notification center** (`HUB-007`) — not required.
- **Announcement image editor & radius/geo targeting** — not required.
- **Per-timezone quiet-hours auto-requeue** — replaced by tenant-configurable
  quiet hours + admin-set send time (above).


3. Claude Api or Another api we are using in the env should be sent to frontend as every company will put there own.
4. News Page is stricted to google api, so it will be same for every comapny, so every company will senf the same news, doesn't feel good, we should give options in the setting to put api and use their own per company right..
5. blogs has been made and created but where it will be displayed.. we sould provide something that the comapny can use that to integerate our blog feature so that blogs will shown on their own website, just like  strapi.